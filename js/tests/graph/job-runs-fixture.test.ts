import { describe, expect, test } from "bun:test";
import { parsePlanJson } from "../../src/parser/parse-plan.ts";
import type { GraphNode } from "../../src/types/graph-types.ts";
import type { Plan } from "../../src/types/plan-schema.ts";
import type { JobRunEffect } from "../../src/utils/normalize-plan.ts";
import {
  buildPlanGraphFromPlan,
  buildResourceGraphFromPlan,
} from "../helpers/build-graphs-from-plan.ts";
import { loadFixture } from "../helpers/load-fixture.ts";

const parsePlan = (rawPlan: Readonly<Record<string, unknown>>): Plan => {
  const result = parsePlanJson({ plan: rawPlan });
  if (!result.ok) throw new Error(`test plan parse failed: ${result.error}`);
  return result.data;
};

const readEffects = (node: GraphNode | undefined): readonly JobRunEffect[] | undefined => {
  if (node === undefined) return undefined;
  if (node.nodeKind === "job" || node.nodeKind === "resource" || node.nodeKind === "phantom") {
    return node.effects;
  }
  return undefined;
};

const findNode = (nodes: readonly GraphNode[], id: string): GraphNode | undefined =>
  nodes.find((node) => node.id === id);

describe("job-runs fixture — effects as annotations", () => {
  test("live cleanup and modern triggers preserve the target job and task", async () => {
    const plan = await loadFixture("cleanup-job-run-triggers");
    const graph = buildResourceGraphFromPlan(plan);
    const planGraph = buildPlanGraphFromPlan(plan);
    const job = findNode(graph.nodes, "resources.jobs.trigger_job");
    const task = findNode(planGraph.nodes, "resources.jobs.trigger_job::main");
    const effects = readEffects(job);

    expect(job?.diffState).toBe("unchanged");
    expect(task?.diffState).toBe("unchanged");
    expect(effects?.map(({ name, action }) => `${name}:${action}`)).toEqual([
      "every_deploy:recreate",
      "file_change:recreate",
      "one_off:delete",
    ]);
    expect(effects?.find(({ name }) => name === "one_off")?.stateOnly).toBe(true);
    expect(
      Object.keys(effects?.find(({ name }) => name === "file_change")?.changes ?? {}),
    ).toContain("lifecycle.triggers_state.on_file_change['watched.txt']");
    expect(
      Object.keys(effects?.find(({ name }) => name === "every_deploy")?.changes ?? {}),
    ).toContain("lifecycle.triggers_state.on_bundle_deploy");
  });
  test("no standalone job_runs nodes appear in either graph", async () => {
    const plan = await loadFixture("job-runs");

    const planGraph = buildPlanGraphFromPlan(plan);
    const resourceGraph = buildResourceGraphFromPlan(plan);

    const allIds = [...planGraph.nodes, ...resourceGraph.nodes].map((node) => node.id);
    expect(allIds.filter((id) => id.startsWith("resources.job_runs."))).toEqual([]);
  });

  test("every job stays unchanged — effects never promote the target", async () => {
    const plan = await loadFixture("job-runs");

    const graph = buildResourceGraphFromPlan(plan);

    const jobs = graph.nodes.filter((node) => node.id.startsWith("resources.jobs."));
    expect(jobs).toHaveLength(5);
    for (const job of jobs) {
      expect(job.diffState).toBe("unchanged");
    }
  });

  test("modern file-trigger effects remain annotations on an unchanged target", () => {
    const plan = parsePlan({
      "resources.jobs.owner": { action: "skip", remote_state: { job_id: 100 } },
      "resources.job_runs.file_change": {
        depends_on: [{ node: "resources.jobs.owner" }],
        action: "recreate",
        changes: {
          "lifecycle.triggers_state.on_file_change": {
            action: "recreate",
            old: { "configs/*.yaml": "hash-before" },
            new: { "configs/*.yaml": "hash-after" },
          },
        },
      },
    });

    const graph = buildResourceGraphFromPlan(plan);
    const owner = findNode(graph.nodes, "resources.jobs.owner");

    expect(owner?.diffState).toBe("unchanged");
    expect(readEffects(owner)?.[0]?.action).toBe("recreate");
    expect(
      readEffects(owner)?.[0]?.changes?.["lifecycle.triggers_state.on_file_change"],
    ).toBeDefined();
  });

  test("jobs carry their effects in both graphs", async () => {
    const plan = await loadFixture("job-runs");

    const planGraph = buildPlanGraphFromPlan(plan);
    const resourceGraph = buildResourceGraphFromPlan(plan);

    for (const nodes of [planGraph.nodes, resourceGraph.nodes]) {
      const warmup = readEffects(findNode(nodes, "resources.jobs.cache_warmup"));
      expect(warmup?.map((effect) => `${effect.name}:${effect.action}`)).toEqual([
        "warm_eu_cache:create",
        "warm_us_cache:skip",
      ]);
      expect(warmup?.find((effect) => effect.name === "warm_us_cache")?.runPageUrl).toContain(
        "/runs/",
      );

      const nightlyReport = readEffects(findNode(nodes, "resources.jobs.nightly_report"));
      expect(nightlyReport?.find((effect) => effect.name === "seed_report")?.runPageUrl).toContain(
        "/runs/",
      );

      const migration = readEffects(findNode(nodes, "resources.jobs.schema_migration"));
      expect(migration).toHaveLength(1);
      expect(migration?.[0]?.action).toBe("recreate");
      expect(Object.keys(migration?.[0]?.changes ?? {})).toEqual([
        "job_parameters['migration_version']",
        "result_state",
      ]);

      const audit = readEffects(findNode(nodes, "resources.jobs.smoke_check"));
      expect(audit?.map((effect) => `${effect.name}:${effect.action}`)).toEqual([
        "one_off_audit:delete",
      ]);
      expect(audit?.[0]?.runPageUrl).toBeUndefined();
    }
  });
});

describe("orphan job_runs effects — phantom targets", () => {
  const orphanOnlyPlan = parsePlan({
    "resources.job_runs.external": {
      action: "create",
      new_state: { value: { job_id: 999 } },
    },
  });

  test("orphan-only plan still builds a resource graph with the phantom", () => {
    const graph = buildResourceGraphFromPlan(orphanOnlyPlan);

    const phantom = findNode(graph.nodes, "job::999");
    expect(phantom?.nodeKind).toBe("phantom");
    expect(readEffects(phantom)?.map((effect) => effect.name)).toEqual(["external"]);
    // The phantom's parent root is materialized and connected even though the
    // plan holds no real resources.
    const root = findNode(graph.nodes, "workspace-root");
    expect(root?.nodeKind).toBe("root");
    expect(
      graph.edges.some((edge) => edge.source === "workspace-root" && edge.target === "job::999"),
    ).toBe(true);
  });

  test("orphan effects never surface in the jobs graph", () => {
    const graph = buildPlanGraphFromPlan(orphanOnlyPlan);

    expect(graph.nodes).toEqual([]);
  });

  test("orphan effect annotations win over a run_job_task phantom collision", () => {
    const plan = parsePlan({
      "resources.jobs.source": {
        action: "create",
        new_state: {
          value: {
            tasks: [{ task_key: "trigger", run_job_task: { job_id: 999 } }],
          },
        },
      },
      "resources.job_runs.external": {
        action: "create",
        new_state: { value: { job_id: 999 } },
      },
    });

    const graph = buildResourceGraphFromPlan(plan);
    const phantom = findNode(graph.nodes, "job::999");

    expect(phantom?.nodeKind).toBe("phantom");
    expect(readEffects(phantom)?.map((effect) => effect.name)).toEqual(["external"]);
  });

  test("the fixture's external run materializes a phantom job target", async () => {
    const plan = await loadFixture("job-runs");

    const resourceGraph = buildResourceGraphFromPlan(plan);
    const planGraph = buildPlanGraphFromPlan(plan);

    // Regens may rotate the external job id — locate the phantom by prefix.
    const phantom = resourceGraph.nodes.find((node) => node.id.startsWith("job::"));
    expect(phantom?.nodeKind).toBe("phantom");
    expect(phantom?.diffState).toBe("unchanged");
    expect(readEffects(phantom)?.map((effect) => `${effect.name}:${effect.action}`)).toEqual([
      "ping_healthcheck:create",
    ]);
    expect(
      resourceGraph.edges.some(
        (edge) => edge.source === "workspace-category::jobs" && edge.target === phantom?.id,
      ),
    ).toBe(true);
    expect(resourceGraph.nodes.map((node) => node.id)).not.toContain("other-resources-root");
    expect(planGraph.nodes.filter((node) => node.id.startsWith("job::"))).toEqual([]);
  });
});
