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
      expect(extractNode?.resourceState).toHaveProperty("notebook_task");
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
      expect(taskNodes.length).toBeGreaterThan(0);
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

      expect(graph.nodes.length).toBeGreaterThan(0);
      expect(graph.edges.length).toBeGreaterThan(0);
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
});
