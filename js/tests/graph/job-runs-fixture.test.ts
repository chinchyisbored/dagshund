import { describe, expect, test } from "bun:test";
import { buildPlanGraph } from "../../src/graph/build-plan-graph.ts";
import { buildResourceGraph } from "../../src/graph/build-resource-graph.ts";
import { parsePlanJson } from "../../src/parser/parse-plan.ts";
import type { GraphNode } from "../../src/types/graph-types.ts";
import type { Plan } from "../../src/types/plan-schema.ts";
import type { JobRunEffect } from "../../src/utils/normalize-plan.ts";
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
  test("no standalone job_runs nodes appear in either graph", async () => {
    const plan = await loadFixture("job-runs");

    const planGraph = buildPlanGraph(plan);
    const resourceGraph = buildResourceGraph(plan);

    const allIds = [...planGraph.nodes, ...resourceGraph.nodes].map((node) => node.id);
    expect(allIds.filter((id) => id.startsWith("resources.job_runs."))).toEqual([]);
  });

  test("every job stays unchanged — effects never promote the target", async () => {
    const plan = await loadFixture("job-runs");

    const graph = buildResourceGraph(plan);

    const jobs = graph.nodes.filter((node) => node.id.startsWith("resources.jobs."));
    expect(jobs).toHaveLength(5);
    for (const job of jobs) {
      expect(job.diffState).toBe("unchanged");
    }
  });

  test("jobs carry their effects in both graphs", async () => {
    const plan = await loadFixture("job-runs");

    const planGraph = buildPlanGraph(plan);
    const resourceGraph = buildResourceGraph(plan);

    for (const nodes of [planGraph.nodes, resourceGraph.nodes]) {
      const warmup = readEffects(findNode(nodes, "resources.jobs.cache_warmup"));
      expect(warmup?.map((effect) => `${effect.name}:${effect.action}`)).toEqual([
        "warm_eu_cache:create",
        "warm_us_cache:skip",
      ]);

      const migration = readEffects(findNode(nodes, "resources.jobs.schema_migration"));
      expect(migration).toHaveLength(1);
      expect(migration?.[0]?.action).toBe("recreate");
      expect(Object.keys(migration?.[0]?.changes ?? {})).toEqual([
        "job_parameters['migration_version']",
      ]);

      const audit = readEffects(findNode(nodes, "resources.jobs.smoke_check"));
      expect(audit?.map((effect) => `${effect.name}:${effect.action}`)).toEqual([
        "one_off_audit:delete",
      ]);
      expect(audit?.[0]?.runPageUrl).toContain("/run/");
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
    const graph = buildResourceGraph(orphanOnlyPlan);

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
    const graph = buildPlanGraph(orphanOnlyPlan);

    expect(graph.nodes).toEqual([]);
  });

  test("the fixture's external run materializes a phantom job target", async () => {
    const plan = await loadFixture("job-runs");

    const resourceGraph = buildResourceGraph(plan);
    const planGraph = buildPlanGraph(plan);

    // Regens may rotate the external job id — locate the phantom by prefix.
    const phantom = resourceGraph.nodes.find((node) => node.id.startsWith("job::"));
    expect(phantom?.nodeKind).toBe("phantom");
    expect(phantom?.diffState).toBe("unchanged");
    expect(readEffects(phantom)?.map((effect) => `${effect.name}:${effect.action}`)).toEqual([
      "ping_healthcheck:create",
    ]);
    expect(planGraph.nodes.filter((node) => node.id.startsWith("job::"))).toEqual([]);
  });
});
