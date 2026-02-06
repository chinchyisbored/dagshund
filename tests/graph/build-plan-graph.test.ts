import { describe, test, expect } from "bun:test";
import { buildPlanGraph } from "../../src/graph/build-plan-graph.ts";
import { parsePlanJson } from "../../src/parser/parse-plan.ts";
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
      expect(jobNodes[0]?.label).toBe("resources.jobs.etl_pipeline");
    });

    test("all nodes have diffState 'added' for a create plan", async () => {
      const plan = await loadFixture("sample-plan.json");
      const graph = buildPlanGraph(plan);

      for (const node of graph.nodes) {
        expect(node.diffState).toBe("added");
      }
    });

    test("creates correct edges from depends_on", async () => {
      const plan = await loadFixture("sample-plan.json");
      const graph = buildPlanGraph(plan);
      const resourceKey = "resources.jobs.etl_pipeline";

      expect(graph.edges).toHaveLength(3);

      const edgePairs = graph.edges.map((e) => [e.source, e.target]);
      expect(edgePairs).toContainEqual([
        `${resourceKey}::extract`,
        `${resourceKey}::transform`,
      ]);
      expect(edgePairs).toContainEqual([
        `${resourceKey}::transform`,
        `${resourceKey}::load`,
      ]);
      expect(edgePairs).toContainEqual([
        `${resourceKey}::load`,
        `${resourceKey}::validate`,
      ]);
    });
  });

  describe("mixed-plan.json (updates/additions/removals)", () => {
    test("creates job node plus task nodes", async () => {
      const plan = await loadFixture("mixed-plan.json");
      const graph = buildPlanGraph(plan);

      const jobNodes = graph.nodes.filter((n) => n.nodeKind === "job");
      const taskNodes = graph.nodes.filter((n) => n.nodeKind === "task");

      expect(jobNodes).toHaveLength(1);
      expect(taskNodes).toHaveLength(4);
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
        graph.nodes.find((n) => n.taskKey === taskKey);

      expect(findTask("extract")?.diffState).toBe("unchanged");
      expect(findTask("load")?.diffState).toBe("unchanged");
      expect(findTask("transform")?.diffState).toBe("modified");
      expect(findTask("aggregate")?.diffState).toBe("added");
    });

    test("creates correct edges for updated task graph", async () => {
      const plan = await loadFixture("mixed-plan.json");
      const graph = buildPlanGraph(plan);
      const resourceKey = "resources.jobs.etl_pipeline";

      expect(graph.edges).toHaveLength(3);

      const edgePairs = graph.edges.map((e) => [e.source, e.target]);
      expect(edgePairs).toContainEqual([
        `${resourceKey}::load`,
        `${resourceKey}::aggregate`,
      ]);
      expect(edgePairs).toContainEqual([
        `${resourceKey}::transform`,
        `${resourceKey}::load`,
      ]);
      expect(edgePairs).toContainEqual([
        `${resourceKey}::extract`,
        `${resourceKey}::transform`,
      ]);
    });

    test("attaches task-specific changes to task nodes", async () => {
      const plan = await loadFixture("mixed-plan.json");
      const graph = buildPlanGraph(plan);

      const transformNode = graph.nodes.find((n) => n.taskKey === "transform");
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
  });
});
