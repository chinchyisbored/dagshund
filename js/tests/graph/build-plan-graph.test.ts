import { describe, expect, test } from "bun:test";
import { buildPlanGraph } from "../../src/graph/build-plan-graph.ts";
import type { TaskGraphNode } from "../../src/types/graph-types.ts";
import { loadFixture } from "../helpers/load-fixture.ts";

describe("buildPlanGraph", () => {
  test("returns empty graph for empty plan", () => {
    const graph = buildPlanGraph({});
    expect(graph.nodes).toHaveLength(0);
    expect(graph.edges).toHaveLength(0);
  });

  test("returns empty graph when plan record is empty", () => {
    const graph = buildPlanGraph({ plan: {} });
    expect(graph.nodes).toHaveLength(0);
    expect(graph.edges).toHaveLength(0);
  });

  describe("sample-plan.json (all creates)", () => {
    test("creates job node plus task nodes", async () => {
      const plan = await loadFixture("sample-plan.json");
      const graph = buildPlanGraph(plan);

      const jobNodes = graph.nodes.filter((n) => n.nodeKind === "job");
      const taskNodes = graph.nodes.filter((n) => n.nodeKind === "task");

      expect(jobNodes).toHaveLength(1);
      expect(taskNodes).toHaveLength(4);
      expect(jobNodes[0]?.label).toBe("etl_pipeline");
    });

    test("all nodes have diffState 'added' for a create plan", async () => {
      const plan = await loadFixture("sample-plan.json");
      const graph = buildPlanGraph(plan);

      for (const node of graph.nodes) {
        expect(node.diffState).toBe("added");
      }
    });

    test("job node has no taskChangeSummary for a create plan (redundant)", async () => {
      const plan = await loadFixture("sample-plan.json");
      const graph = buildPlanGraph(plan);

      const jobNode = graph.nodes.find((n) => n.nodeKind === "job");
      expect(jobNode?.taskChangeSummary).toBeUndefined();
    });

    test("creates correct edges from depends_on", async () => {
      const plan = await loadFixture("sample-plan.json");
      const graph = buildPlanGraph(plan);
      const resourceKey = "resources.jobs.etl_pipeline";

      expect(graph.edges).toHaveLength(3);

      const edgePairs = graph.edges.map((e) => [e.source, e.target]);
      expect(edgePairs).toContainEqual([`${resourceKey}::extract`, `${resourceKey}::transform`]);
      expect(edgePairs).toContainEqual([`${resourceKey}::transform`, `${resourceKey}::load`]);
      expect(edgePairs).toContainEqual([`${resourceKey}::load`, `${resourceKey}::validate`]);
    });

    test("all edges have diffState 'added' for a create plan", async () => {
      const plan = await loadFixture("sample-plan.json");
      const graph = buildPlanGraph(plan);

      for (const edge of graph.edges) {
        expect(edge.diffState).toBe("added");
      }
    });
  });

  describe("mixed-plan.json (skip jobs with remote_state tasks)", () => {
    test("creates job nodes for both skip jobs with tasks from remote_state", async () => {
      const plan = await loadFixture("mixed-plan.json");
      const graph = buildPlanGraph(plan);

      const jobNodes = graph.nodes.filter((n) => n.nodeKind === "job");
      expect(jobNodes).toHaveLength(2);

      const labels = jobNodes.map((n) => n.label).sort();
      expect(labels).toEqual(["data_quality_pipeline", "etl_pipeline"]);
    });

    test("extracts tasks from remote_state for skip jobs", async () => {
      const plan = await loadFixture("mixed-plan.json");
      const graph = buildPlanGraph(plan);

      const etlTasks = graph.nodes.filter(
        (n): n is TaskGraphNode =>
          n.nodeKind === "task" && n.resourceKey === "resources.jobs.etl_pipeline",
      );
      const dqTasks = graph.nodes.filter(
        (n): n is TaskGraphNode =>
          n.nodeKind === "task" && n.resourceKey === "resources.jobs.data_quality_pipeline",
      );

      expect(etlTasks).toHaveLength(5);
      expect(dqTasks).toHaveLength(9);
    });

    test("all nodes have diffState unchanged for skip jobs with skip changes", async () => {
      const plan = await loadFixture("mixed-plan.json");
      const graph = buildPlanGraph(plan);

      for (const node of graph.nodes) {
        expect(node.diffState).toBe("unchanged");
      }
    });

    test("creates correct intra-job edges from remote_state depends_on", async () => {
      const plan = await loadFixture("mixed-plan.json");
      const graph = buildPlanGraph(plan);
      const rk = "resources.jobs.etl_pipeline";

      const etlEdges = graph.edges.filter(
        (e) => e.source.startsWith(`${rk}::`) && e.target.startsWith(`${rk}::`),
      );
      expect(etlEdges).toHaveLength(4);

      const edgePairs = etlEdges.map((e) => [e.source, e.target]);
      expect(edgePairs).toContainEqual([`${rk}::extract`, `${rk}::transform`]);
      expect(edgePairs).toContainEqual([`${rk}::transform`, `${rk}::load`]);
      expect(edgePairs).toContainEqual([`${rk}::load`, `${rk}::aggregate`]);
      expect(edgePairs).toContainEqual([`${rk}::aggregate`, `${rk}::trigger_quality_check`]);
    });

    test("all edges have diffState unchanged", async () => {
      const plan = await loadFixture("mixed-plan.json");
      const graph = buildPlanGraph(plan);

      for (const edge of graph.edges) {
        expect(edge.diffState).toBe("unchanged");
      }
    });

    test("attaches job-level changes (non-task) to job node", async () => {
      const plan = await loadFixture("mixed-plan.json");
      const graph = buildPlanGraph(plan);

      const jobNode = graph.nodes.find(
        (n) => n.nodeKind === "job" && n.id === "resources.jobs.etl_pipeline",
      );
      expect(jobNode?.changes).toBeDefined();
      if (jobNode?.changes) {
        const changeKeys = Object.keys(jobNode.changes);
        const hasTaskKey = changeKeys.some((k) => k.startsWith("tasks["));
        expect(hasTaskKey).toBe(false);
      }
    });

    test("attaches resourceState from remote_state to job node without tasks", async () => {
      const plan = await loadFixture("mixed-plan.json");
      const graph = buildPlanGraph(plan);

      const jobNode = graph.nodes.find(
        (n) => n.nodeKind === "job" && n.id === "resources.jobs.etl_pipeline",
      );
      expect(jobNode?.resourceState).toBeDefined();
      expect(jobNode?.resourceState).toHaveProperty("name", "etl_pipeline");
      expect(jobNode?.resourceState).toHaveProperty("format", "MULTI_TASK");
      expect(jobNode?.resourceState).not.toHaveProperty("tasks");
    });

    test("attaches resourceState to task nodes from remote_state", async () => {
      const plan = await loadFixture("mixed-plan.json");
      const graph = buildPlanGraph(plan);

      const extractNode = graph.nodes.find((n) => n.nodeKind === "task" && n.taskKey === "extract");
      expect(extractNode?.resourceState).toBeDefined();
      expect(extractNode?.resourceState).toHaveProperty("task_key", "extract");
      expect(extractNode?.resourceState?.["notebook_task"]).toEqual({
        notebook_path: "/Workspace/etl/extract",
        source: "WORKSPACE",
      });
    });

    test("taskChangeSummary is undefined for skip jobs with only skip changes", async () => {
      const plan = await loadFixture("mixed-plan.json");
      const graph = buildPlanGraph(plan);

      const jobNode = graph.nodes.find((n) => n.nodeKind === "job");
      expect(jobNode?.taskChangeSummary).toBeUndefined();
    });

    test("creates cross-job edge from trigger_quality_check to data_quality_pipeline", async () => {
      const plan = await loadFixture("mixed-plan.json");
      const graph = buildPlanGraph(plan);

      const crossJobEdge = graph.edges.find(
        (e) =>
          e.source === "resources.jobs.etl_pipeline::trigger_quality_check" &&
          e.target === "resources.jobs.data_quality_pipeline",
      );
      expect(crossJobEdge).toBeDefined();
      expect(crossJobEdge?.diffState).toBe("unchanged");
    });
  });

  describe("no-changes-plan.json (all skip, no new_state)", () => {
    test("extracts tasks from remote_state when new_state is absent", async () => {
      const plan = await loadFixture("no-changes-plan.json");
      const graph = buildPlanGraph(plan);

      const jobNodes = graph.nodes.filter((n) => n.nodeKind === "job");
      const taskNodes = graph.nodes.filter((n) => n.nodeKind === "task");

      expect(jobNodes).toHaveLength(2);
      expect(taskNodes).toHaveLength(14);
    });

    test("all nodes have diffState unchanged for all-skip plan", async () => {
      const plan = await loadFixture("no-changes-plan.json");
      const graph = buildPlanGraph(plan);

      for (const node of graph.nodes) {
        expect(node.diffState).toBe("unchanged");
      }
    });

    test("graph is non-empty (original bug: was empty for all-skip plans)", async () => {
      const plan = await loadFixture("no-changes-plan.json");
      const graph = buildPlanGraph(plan);

      expect(graph.nodes).toHaveLength(16);
      expect(graph.edges).toHaveLength(17);
    });
  });

  describe("deleted task with run_job_task", () => {
    test("creates cross-job edge with 'removed' diffState for deleted run_job_task", () => {
      const plan = {
        plan: {
          "resources.jobs.pipeline_a": {
            action: "update" as const,
            new_state: {
              value: {
                tasks: [{ task_key: "extract" }],
              },
            },
            remote_state: {
              job_id: 100,
              tasks: [
                { task_key: "extract" },
                {
                  task_key: "trigger_b",
                  // biome-ignore lint/suspicious/noTemplateCurlyInString: Databricks bundle interpolation syntax, not a JS template
                  run_job_task: { job_id: "${resources.jobs.pipeline_b.id}" },
                },
              ],
            },
            changes: {
              "tasks[task_key='trigger_b']": {
                action: "delete" as const,
                old: {
                  task_key: "trigger_b",
                  // biome-ignore lint/suspicious/noTemplateCurlyInString: Databricks bundle interpolation syntax, not a JS template
                  run_job_task: { job_id: "${resources.jobs.pipeline_b.id}" },
                },
              },
            },
          },
          "resources.jobs.pipeline_b": {
            action: "skip" as const,
            remote_state: {
              job_id: 200,
              tasks: [{ task_key: "ingest" }],
            },
          },
        },
      };

      const graph = buildPlanGraph(plan);

      const crossJobEdge = graph.edges.find(
        (e) =>
          e.source === "resources.jobs.pipeline_a::trigger_b" &&
          e.target === "resources.jobs.pipeline_b",
      );
      expect(crossJobEdge).toBeDefined();
      expect(crossJobEdge?.diffState).toBe("removed");
    });
  });

  describe("sub-resources-plan.json (sub-resource merging)", () => {
    test("creates only one job node, merging sub-resources into parent", async () => {
      const plan = await loadFixture("sub-resources-plan.json");
      const graph = buildPlanGraph(plan);

      const jobNodes = graph.nodes.filter((n) => n.nodeKind === "job");
      expect(jobNodes).toHaveLength(1);
      expect(jobNodes[0]?.label).toBe("test_job");
    });

    test("does not create nodes for permissions or grants sub-resources", async () => {
      const plan = await loadFixture("sub-resources-plan.json");
      const graph = buildPlanGraph(plan);

      const nodeIds = graph.nodes.map((n) => n.id);
      expect(nodeIds).not.toContain("resources.jobs.test_job.permissions");
      expect(nodeIds).not.toContain("resources.schemas.analytics.grants");
    });
  });

  describe("complex-plan.json (numeric job_id)", () => {
    test("extracts all tasks from etl_pipeline including run_job_task with numeric job_id", async () => {
      const plan = await loadFixture("complex-plan.json");
      const graph = buildPlanGraph(plan);

      const etlTaskNodes = graph.nodes.filter(
        (n): n is TaskGraphNode =>
          n.nodeKind === "task" && n.resourceKey === "resources.jobs.etl_pipeline",
      );
      const taskKeys = etlTaskNodes.map((n) => n.taskKey).sort();
      expect(taskKeys).toEqual([
        "aggregate",
        "extract",
        "load",
        "transform",
        "trigger_quality_check",
        "validate",
      ]);
    });

    test("creates cross-job edge from trigger_quality_check to data_quality_pipeline via numeric job_id", async () => {
      const plan = await loadFixture("complex-plan.json");
      const graph = buildPlanGraph(plan);

      const crossJobEdge = graph.edges.find(
        (e) =>
          e.source === "resources.jobs.etl_pipeline::trigger_quality_check" &&
          e.target === "resources.jobs.data_quality_pipeline",
      );
      expect(crossJobEdge).toBeDefined();
      expect(crossJobEdge?.diffState).toBe("added");
    });
  });

  describe("dependency-changes-plan.json (golden fixture — 18 depends_on scenarios)", () => {
    const etl = "resources.jobs.etl_pipeline";
    const data = "resources.jobs.data_pipeline";

    const findEdge = (graph: ReturnType<typeof buildPlanGraph>, source: string, target: string) =>
      graph.edges.find((e) => e.source === source && e.target === target);

    // --- Job 1: conditional scenarios ---

    test("#1 unchanged root: extract has no edges", async () => {
      const graph = buildPlanGraph(await loadFixture("dependency-changes-plan.json"));
      const extractEdges = graph.edges.filter(
        (e) => e.source === `${etl}::extract` || e.target === `${etl}::extract`,
      );
      const incomingUnchanged = extractEdges.filter(
        (e) => e.target === `${etl}::extract` && e.diffState === "unchanged",
      );
      expect(incomingUnchanged).toHaveLength(0);
    });

    test("#2 unchanged with deps: transform→load edges are unchanged", async () => {
      const graph = buildPlanGraph(await loadFixture("dependency-changes-plan.json"));
      const edge1 = findEdge(graph, `${etl}::extract`, `${etl}::transform`);
      const edge2 = findEdge(graph, `${etl}::transform`, `${etl}::load`);
      expect(edge1?.diffState).toBe("unchanged");
      expect(edge2?.diffState).toBe("unchanged");
    });

    test("#6 1→1 swap with outcome removal: full_validation has removed edge from check_row_count and added edge from load", async () => {
      const graph = buildPlanGraph(await loadFixture("dependency-changes-plan.json"));
      const removed = findEdge(graph, `${etl}::check_row_count`, `${etl}::full_validation`);
      const added = findEdge(graph, `${etl}::load`, `${etl}::full_validation`);
      expect(removed?.diffState).toBe("removed");
      expect(added?.diffState).toBe("added");
    });

    test("#8 2→1 shrink: publish keeps full_validation edge, loses skip_validation edge", async () => {
      const graph = buildPlanGraph(await loadFixture("dependency-changes-plan.json"));
      const kept = findEdge(graph, `${etl}::full_validation`, `${etl}::publish`);
      const removed = findEdge(graph, `${etl}::skip_validation`, `${etl}::publish`);
      expect(kept?.diffState).toBe("unchanged");
      expect(removed?.diffState).toBe("removed");
    });

    test("#15 removed with deps: check_row_count has removed edge from load", async () => {
      const graph = buildPlanGraph(await loadFixture("dependency-changes-plan.json"));
      const edge = findEdge(graph, `${etl}::load`, `${etl}::check_row_count`);
      expect(edge?.diffState).toBe("removed");
    });

    test("#15 removed with deps: skip_validation has removed edge from check_row_count", async () => {
      const graph = buildPlanGraph(await loadFixture("dependency-changes-plan.json"));
      const edge = findEdge(graph, `${etl}::check_row_count`, `${etl}::skip_validation`);
      expect(edge?.diffState).toBe("removed");
    });

    test("#16 removed task was depended on: check_row_count has removed edges to both branches", async () => {
      const graph = buildPlanGraph(await loadFixture("dependency-changes-plan.json"));
      const toFull = findEdge(graph, `${etl}::check_row_count`, `${etl}::full_validation`);
      const toSkip = findEdge(graph, `${etl}::check_row_count`, `${etl}::skip_validation`);
      expect(toFull?.diffState).toBe("removed");
      expect(toSkip?.diffState).toBe("removed");
    });

    // --- Job 2: non-conditional scenarios ---

    test("#3 0→1 add first dep: monitor gains added edge from ingest", async () => {
      const graph = buildPlanGraph(await loadFixture("dependency-changes-plan.json"));
      const edge = findEdge(graph, `${data}::ingest`, `${data}::monitor`);
      expect(edge?.diffState).toBe("added");
    });

    test("#4 1→0 remove all deps: normalize loses edge from ingest", async () => {
      const graph = buildPlanGraph(await loadFixture("dependency-changes-plan.json"));
      const edge = findEdge(graph, `${data}::ingest`, `${data}::normalize`);
      expect(edge?.diffState).toBe("removed");
    });

    test("#5 1→1 swap: clean swaps dep from normalize to ingest", async () => {
      const graph = buildPlanGraph(await loadFixture("dependency-changes-plan.json"));
      const removed = findEdge(graph, `${data}::normalize`, `${data}::clean`);
      const added = findEdge(graph, `${data}::ingest`, `${data}::clean`);
      expect(removed?.diffState).toBe("removed");
      expect(added?.diffState).toBe("added");
    });

    test("#7 1→2 grow: enrich keeps validate edge, gains clean edge", async () => {
      const graph = buildPlanGraph(await loadFixture("dependency-changes-plan.json"));
      const kept = findEdge(graph, `${data}::validate`, `${data}::enrich`);
      const added = findEdge(graph, `${data}::clean`, `${data}::enrich`);
      expect(kept?.diffState).toBe("unchanged");
      expect(added?.diffState).toBe("added");
    });

    test("#9 2→2 swap one: process_a keeps clean edge, swaps filter for validate", async () => {
      const graph = buildPlanGraph(await loadFixture("dependency-changes-plan.json"));
      const kept = findEdge(graph, `${data}::clean`, `${data}::process_a`);
      const removed = findEdge(graph, `${data}::filter`, `${data}::process_a`);
      const added = findEdge(graph, `${data}::validate`, `${data}::process_a`);
      expect(kept?.diffState).toBe("unchanged");
      expect(removed?.diffState).toBe("removed");
      expect(added?.diffState).toBe("added");
    });

    test("#10 2→2 swap both: process_b swaps clean→ingest and filter→validate", async () => {
      const graph = buildPlanGraph(await loadFixture("dependency-changes-plan.json"));
      const removedClean = findEdge(graph, `${data}::clean`, `${data}::process_b`);
      const removedFilter = findEdge(graph, `${data}::filter`, `${data}::process_b`);
      const addedIngest = findEdge(graph, `${data}::ingest`, `${data}::process_b`);
      const addedValidate = findEdge(graph, `${data}::validate`, `${data}::process_b`);
      expect(removedClean?.diffState).toBe("removed");
      expect(removedFilter?.diffState).toBe("removed");
      expect(addedIngest?.diffState).toBe("added");
      expect(addedValidate?.diffState).toBe("added");
    });

    test("#11 2→2 reorder: combine edges are unchanged (set-based comparison)", async () => {
      const graph = buildPlanGraph(await loadFixture("dependency-changes-plan.json"));
      const edgeA = findEdge(graph, `${data}::process_a`, `${data}::combine`);
      const edgeB = findEdge(graph, `${data}::process_b`, `${data}::combine`);
      expect(edgeA?.diffState).toBe("unchanged");
      expect(edgeB?.diffState).toBe("unchanged");
    });

    test("#12 new task no deps: audit node exists with added state", async () => {
      const graph = buildPlanGraph(await loadFixture("dependency-changes-plan.json"));
      const node = graph.nodes.find((n) => n.nodeKind === "task" && n.id === `${data}::audit`);
      expect(node?.diffState).toBe("added");
      const edges = graph.edges.filter(
        (e) => e.source === `${data}::audit` || e.target === `${data}::audit`,
      );
      expect(edges).toHaveLength(0);
    });

    test("#13 new task with deps: clean_v2 has added edge from clean", async () => {
      const graph = buildPlanGraph(await loadFixture("dependency-changes-plan.json"));
      const edge = findEdge(graph, `${data}::clean`, `${data}::clean_v2`);
      expect(edge?.diffState).toBe("added");
    });

    test("#14 removed task no deps: standby node exists with removed state and no edges", async () => {
      const graph = buildPlanGraph(await loadFixture("dependency-changes-plan.json"));
      const node = graph.nodes.find((n) => n.nodeKind === "task" && n.id === `${data}::standby`);
      expect(node?.diffState).toBe("removed");
      const ownEdges = graph.edges.filter(
        (e) => e.source === `${data}::standby` && e.target === `${data}::standby`,
      );
      expect(ownEdges).toHaveLength(0);
    });

    test("#17 swap to newly added task: validate swaps dep from clean to clean_v2", async () => {
      const graph = buildPlanGraph(await loadFixture("dependency-changes-plan.json"));
      const removed = findEdge(graph, `${data}::clean`, `${data}::validate`);
      const added = findEdge(graph, `${data}::clean_v2`, `${data}::validate`);
      expect(removed?.diffState).toBe("removed");
      expect(added?.diffState).toBe("added");
    });

    test("#18 dep on removed task replaced: filter swaps dep from standby to ingest", async () => {
      const graph = buildPlanGraph(await loadFixture("dependency-changes-plan.json"));
      const removed = findEdge(graph, `${data}::standby`, `${data}::filter`);
      const added = findEdge(graph, `${data}::ingest`, `${data}::filter`);
      expect(removed?.diffState).toBe("removed");
      expect(added?.diffState).toBe("added");
    });

    test("#2 unchanged with deps (data_pipeline): output→combine edge unchanged", async () => {
      const graph = buildPlanGraph(await loadFixture("dependency-changes-plan.json"));
      const edge = findEdge(graph, `${data}::combine`, `${data}::output`);
      expect(edge?.diffState).toBe("unchanged");
    });
  });
});
