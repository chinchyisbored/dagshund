import { describe, expect, test } from "bun:test";
import { buildPlanGraph } from "../../src/graph/build-plan-graph.ts";
import { parsePlanJson } from "../../src/parser/parse-plan.ts";
import type { JobGraphNode, TaskGraphNode } from "../../src/types/graph-types.ts";
import type { Plan } from "../../src/types/plan-schema.ts";

const loadFixture = async (name: string): Promise<Plan> => {
  const text = await Bun.file(`tests/fixtures/${name}`).text();
  const result = parsePlanJson(JSON.parse(text));
  if (!result.ok) throw new Error(`Fixture parse failed: ${result.error}`);
  return result.data;
};

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

  describe("mixed-plan.json (updates/additions/removals)", () => {
    test("creates job node plus task nodes including ghost nodes", async () => {
      const plan = await loadFixture("mixed-plan.json");
      const graph = buildPlanGraph(plan);

      const jobNodes = graph.nodes.filter((n) => n.nodeKind === "job");
      const taskNodes = graph.nodes.filter((n) => n.nodeKind === "task");

      expect(jobNodes).toHaveLength(1);
      expect(taskNodes).toHaveLength(5); // 4 live + 1 ghost (validate)
    });

    test("ghost node for deleted task has diffState 'removed'", async () => {
      const plan = await loadFixture("mixed-plan.json");
      const graph = buildPlanGraph(plan);

      const validateNode = graph.nodes.find(
        (n) => n.nodeKind === "task" && n.taskKey === "validate",
      );
      expect(validateNode).toBeDefined();
      expect(validateNode?.diffState).toBe("removed");
    });

    test("job node has diffState 'modified' for update action", async () => {
      const plan = await loadFixture("mixed-plan.json");
      const graph = buildPlanGraph(plan);

      const jobNode = graph.nodes.find((n) => n.nodeKind === "job");
      expect(jobNode?.diffState).toBe("modified");
    });

    test("correctly resolves task diff states", async () => {
      const plan = await loadFixture("mixed-plan.json");
      const graph = buildPlanGraph(plan);

      const findTask = (taskKey: string) =>
        graph.nodes.find((n) => n.nodeKind === "task" && n.taskKey === taskKey);

      expect(findTask("extract")?.diffState).toBe("unchanged");
      expect(findTask("load")?.diffState).toBe("unchanged");
      expect(findTask("transform")?.diffState).toBe("modified");
      expect(findTask("aggregate")?.diffState).toBe("added");
      expect(findTask("validate")?.diffState).toBe("removed");
    });

    test("creates correct edges including ghost edges", async () => {
      const plan = await loadFixture("mixed-plan.json");
      const graph = buildPlanGraph(plan);
      const resourceKey = "resources.jobs.etl_pipeline";

      expect(graph.edges).toHaveLength(4); // 3 live + 1 ghost (load→validate)

      const edgePairs = graph.edges.map((e) => [e.source, e.target]);
      expect(edgePairs).toContainEqual([`${resourceKey}::load`, `${resourceKey}::aggregate`]);
      expect(edgePairs).toContainEqual([`${resourceKey}::transform`, `${resourceKey}::load`]);
      expect(edgePairs).toContainEqual([`${resourceKey}::extract`, `${resourceKey}::transform`]);
      expect(edgePairs).toContainEqual([`${resourceKey}::load`, `${resourceKey}::validate`]);
    });

    test("edges have correct diffState values", async () => {
      const plan = await loadFixture("mixed-plan.json");
      const graph = buildPlanGraph(plan);
      const resourceKey = "resources.jobs.etl_pipeline";

      const findEdge = (source: string, target: string) =>
        graph.edges.find(
          (e) =>
            e.source === `${resourceKey}::${source}` && e.target === `${resourceKey}::${target}`,
        );

      expect(findEdge("extract", "transform")?.diffState).toBe("unchanged");
      expect(findEdge("transform", "load")?.diffState).toBe("unchanged");
      expect(findEdge("load", "aggregate")?.diffState).toBe("added");
      expect(findEdge("load", "validate")?.diffState).toBe("removed");
    });

    test("attaches task-specific changes to task nodes", async () => {
      const plan = await loadFixture("mixed-plan.json");
      const graph = buildPlanGraph(plan);

      const transformNode = graph.nodes.find(
        (n) => n.nodeKind === "task" && n.taskKey === "transform",
      );
      expect(transformNode?.changes).toBeDefined();
      expect(
        transformNode?.changes?.["tasks[task_key='transform'].notebook_task.notebook_path"],
      ).toBeDefined();
    });

    test("attaches job-level changes (non-task) to job node", async () => {
      const plan = await loadFixture("mixed-plan.json");
      const graph = buildPlanGraph(plan);

      const jobNode = graph.nodes.find((n) => n.nodeKind === "job");
      expect(jobNode?.changes).toBeDefined();
      if (jobNode?.changes) {
        const changeKeys = Object.keys(jobNode.changes);
        const hasTaskKey = changeKeys.some((k) => k.startsWith("tasks["));
        expect(hasTaskKey).toBe(false);
      }
    });

    test("attaches resourceState to job node without tasks", async () => {
      const plan = await loadFixture("mixed-plan.json");
      const graph = buildPlanGraph(plan);

      const jobNode = graph.nodes.find((n) => n.nodeKind === "job");
      expect(jobNode?.resourceState).toBeDefined();
      expect(jobNode?.resourceState).toHaveProperty("name", "etl_pipeline");
      expect(jobNode?.resourceState).toHaveProperty("format", "MULTI_TASK");
      expect(jobNode?.resourceState).not.toHaveProperty("tasks");
    });

    test("attaches resourceState to task nodes", async () => {
      const plan = await loadFixture("mixed-plan.json");
      const graph = buildPlanGraph(plan);

      const extractNode = graph.nodes.find((n) => n.nodeKind === "task" && n.taskKey === "extract");
      expect(extractNode?.resourceState).toBeDefined();
      expect(extractNode?.resourceState).toHaveProperty("task_key", "extract");
      expect(extractNode?.resourceState).toHaveProperty("notebook_task");
    });

    test("job node has taskChangeSummary with modified tasks", async () => {
      const plan = await loadFixture("mixed-plan.json");
      const graph = buildPlanGraph(plan);

      const jobNode = graph.nodes.find((n) => n.nodeKind === "job");
      expect(jobNode?.taskChangeSummary).toBeDefined();
      const summary = jobNode?.taskChangeSummary ?? [];
      expect(summary.length).toBeGreaterThan(0);

      const taskKeys = summary.map((e) => e.taskKey);
      expect(taskKeys).toContain("transform");
      expect(taskKeys).toContain("aggregate");
    });

    test("task nodes have undefined taskChangeSummary", async () => {
      const plan = await loadFixture("mixed-plan.json");
      const graph = buildPlanGraph(plan);

      const taskNodes = graph.nodes.filter((n) => n.nodeKind === "task");
      for (const task of taskNodes) {
        // taskChangeSummary does not exist on TaskGraphNode — verify it's absent at runtime
        expect((task as unknown as JobGraphNode).taskChangeSummary).toBeUndefined();
      }
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
