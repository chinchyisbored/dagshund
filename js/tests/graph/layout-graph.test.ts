import { describe, expect, test } from "bun:test";
import type { JobGraphNode, PlanGraph, TaskGraphNode } from "../../src/types/graph-types.ts";

/**
 * These tests import pure helper functions from layout-graph.ts.
 * The ELK Worker integration cannot run in Bun's test runner (Workers get terminated),
 * so we test the transformation logic that feeds into and comes out of ELK.
 * The full ELK layout pipeline is verified visually via `bun run dev`.
 */

// Dynamic import to avoid module-level ELK Worker instantiation in tests.
let mod: Awaited<typeof import("../../src/graph/layout-graph.ts")>;

const loadModule = async () => {
  if (!mod) {
    mod = await import("../../src/graph/layout-graph.ts");
  }
  return mod;
};

const JOB_NODE: JobGraphNode = {
  id: "resources.jobs.etl",
  label: "resources.jobs.etl",
  nodeKind: "job",
  diffState: "added",
  resourceKey: "resources.jobs.etl",
  changes: undefined,
  resourceState: undefined,
  newState: undefined,
  remoteState: undefined,
  resourceHasShapeDrift: false,
  taskChangeSummary: undefined,
};

const TASK_EXTRACT: TaskGraphNode = {
  id: "resources.jobs.etl::extract",
  label: "extract",
  nodeKind: "task",
  diffState: "added",
  resourceKey: "resources.jobs.etl",
  taskKey: "extract",
  changes: undefined,
  resourceState: undefined,
  newState: undefined,
  remoteState: undefined,
  resourceHasShapeDrift: false,
};

const TASK_TRANSFORM: TaskGraphNode = {
  id: "resources.jobs.etl::transform",
  label: "transform",
  nodeKind: "task",
  diffState: "modified",
  resourceKey: "resources.jobs.etl",
  taskKey: "transform",
  changes: undefined,
  resourceState: undefined,
  newState: undefined,
  remoteState: undefined,
  resourceHasShapeDrift: false,
};

const SINGLE_JOB_GRAPH: PlanGraph = {
  nodes: [JOB_NODE, TASK_EXTRACT, TASK_TRANSFORM],
  edges: [
    {
      id: "resources.jobs.etl::extract→resources.jobs.etl::transform",
      source: "resources.jobs.etl::extract",
      target: "resources.jobs.etl::transform",
      label: undefined,
      diffState: "unchanged",
    },
  ],
};

describe("groupNodesByJob", () => {
  test("groups tasks under their parent job", async () => {
    const { groupNodesByJob } = await loadModule();
    const groups = groupNodesByJob(SINGLE_JOB_GRAPH.nodes);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.job.id).toBe("resources.jobs.etl");
    expect(groups[0]?.tasks).toHaveLength(2);
    expect(groups[0]?.tasks.map((t) => t.id)).toContain("resources.jobs.etl::extract");
    expect(groups[0]?.tasks.map((t) => t.id)).toContain("resources.jobs.etl::transform");
  });

  test("returns empty array for empty nodes", async () => {
    const { groupNodesByJob } = await loadModule();
    const groups = groupNodesByJob([]);
    expect(groups).toHaveLength(0);
  });

  test("handles multiple jobs", async () => {
    const { groupNodesByJob } = await loadModule();
    const secondJob: JobGraphNode = {
      ...JOB_NODE,
      id: "resources.jobs.ingest",
      resourceKey: "resources.jobs.ingest",
    };
    const secondTask: TaskGraphNode = {
      ...TASK_EXTRACT,
      id: "resources.jobs.ingest::load",
      resourceKey: "resources.jobs.ingest",
      taskKey: "load",
    };
    const groups = groupNodesByJob([JOB_NODE, TASK_EXTRACT, secondJob, secondTask]);

    expect(groups).toHaveLength(2);
  });
});

describe("topologicalSortTasks", () => {
  test("sorts tasks so dependencies come before dependents", async () => {
    const { topologicalSortTasks } = await loadModule();

    const taskA: TaskGraphNode = {
      ...TASK_EXTRACT,
      id: "resources.jobs.etl::aggregate_results",
      taskKey: "aggregate_results",
      label: "aggregate_results",
    };
    const taskB: TaskGraphNode = {
      ...TASK_EXTRACT,
      id: "resources.jobs.etl::setup_env",
      taskKey: "setup_env",
      label: "setup_env",
    };
    const taskC: TaskGraphNode = {
      ...TASK_EXTRACT,
      id: "resources.jobs.etl::run_tests",
      taskKey: "run_tests",
      label: "run_tests",
    };

    // Input in alphabetical order (wrong dependency order):
    // aggregate_results depends on run_tests, run_tests depends on setup_env
    const tasks = [taskA, taskC, taskB];
    const edges = [
      { source: "resources.jobs.etl::setup_env", target: "resources.jobs.etl::run_tests" },
      { source: "resources.jobs.etl::run_tests", target: "resources.jobs.etl::aggregate_results" },
    ];

    const sorted = topologicalSortTasks(tasks, edges);
    // topologicalSortTasks returns readonly GraphNode[]; narrow to TaskGraphNode to access taskKey.
    const sortedKeys = sorted.map((t) => (t as TaskGraphNode).taskKey);

    const setupIdx = sortedKeys.indexOf("setup_env");
    const runIdx = sortedKeys.indexOf("run_tests");
    const aggIdx = sortedKeys.indexOf("aggregate_results");

    expect(setupIdx).toBeLessThan(runIdx);
    expect(runIdx).toBeLessThan(aggIdx);
  });

  test("preserves original order for tasks with no edges", async () => {
    const { topologicalSortTasks } = await loadModule();

    const taskA: TaskGraphNode = { ...TASK_EXTRACT, id: "j::a", taskKey: "a" };
    const taskB: TaskGraphNode = { ...TASK_EXTRACT, id: "j::b", taskKey: "b" };
    const taskC: TaskGraphNode = { ...TASK_EXTRACT, id: "j::c", taskKey: "c" };

    const sorted = topologicalSortTasks([taskA, taskB, taskC], []);
    const sortedKeys = sorted.map((t) => (t as TaskGraphNode).taskKey);
    expect(sortedKeys).toEqual(["a", "b", "c"]);
  });

  test("ignores edges from other jobs", async () => {
    const { topologicalSortTasks } = await loadModule();

    const taskA: TaskGraphNode = { ...TASK_EXTRACT, id: "j::a", taskKey: "a" };
    const taskB: TaskGraphNode = { ...TASK_EXTRACT, id: "j::b", taskKey: "b" };

    // Edge from a different job — should be ignored
    const edges = [{ source: "other::x", target: "j::a" }];

    const sorted = topologicalSortTasks([taskA, taskB], edges);
    const sortedKeys = sorted.map((t) => (t as TaskGraphNode).taskKey);
    expect(sortedKeys).toEqual(["a", "b"]);
  });
});

describe("buildElkCompoundGraph", () => {
  test("creates hierarchical ELK graph with jobs containing task children", async () => {
    const { buildElkCompoundGraph, groupNodesByJob } = await loadModule();
    const elkGraph = buildElkCompoundGraph(
      groupNodesByJob(SINGLE_JOB_GRAPH.nodes),
      SINGLE_JOB_GRAPH.edges,
    );

    expect(elkGraph.id).toBe("root");
    expect(elkGraph.children).toHaveLength(1);

    expect(elkGraph.children[0]?.id).toBe("resources.jobs.etl");
    expect(elkGraph.children[0]?.children).toHaveLength(2);
    expect(elkGraph.children[0]?.children.map((c) => c.id)).toContain(
      "resources.jobs.etl::extract",
    );
  });

  test("nests edges inside their parent job container", async () => {
    const { buildElkCompoundGraph, groupNodesByJob } = await loadModule();
    const elkGraph = buildElkCompoundGraph(
      groupNodesByJob(SINGLE_JOB_GRAPH.nodes),
      SINGLE_JOB_GRAPH.edges,
    );

    expect(elkGraph.children[0]?.edges).toHaveLength(1);
    expect(elkGraph.children[0]?.edges[0]?.sources).toContain("resources.jobs.etl::extract");
    expect(elkGraph.children[0]?.edges[0]?.targets).toContain("resources.jobs.etl::transform");

    // Root should have no edges (all edges are intra-job)
    expect(elkGraph.edges).toHaveLength(0);
  });

  test("sets LEFT-to-RIGHT direction on job containers", async () => {
    const { buildElkCompoundGraph, groupNodesByJob } = await loadModule();
    const elkGraph = buildElkCompoundGraph(
      groupNodesByJob(SINGLE_JOB_GRAPH.nodes),
      SINGLE_JOB_GRAPH.edges,
    );

    expect(elkGraph.children[0]?.layoutOptions["elk.direction"]).toBe("RIGHT");
  });

  test("returns empty children for empty graph", async () => {
    const { buildElkCompoundGraph } = await loadModule();
    const elkGraph = buildElkCompoundGraph([], []);
    expect(elkGraph.children).toHaveLength(0);
  });
});

describe("extractLayoutData", () => {
  test("extracts positions and dimensions from ELK result", async () => {
    const { extractLayoutData } = await loadModule();
    const mockResult = {
      children: [
        {
          id: "resources.jobs.etl",
          x: 10,
          y: 20,
          width: 500,
          height: 200,
          children: [
            { id: "resources.jobs.etl::extract", x: 30, y: 40 },
            { id: "resources.jobs.etl::transform", x: 250, y: 40 },
          ],
        },
      ],
    };

    const { positions, dimensions } = extractLayoutData(mockResult);

    expect(positions.get("resources.jobs.etl")).toEqual({ x: 10, y: 20 });
    expect(positions.get("resources.jobs.etl::extract")).toEqual({ x: 30, y: 40 });
    expect(dimensions.get("resources.jobs.etl")).toEqual({ width: 500, height: 200 });
  });

  test("handles empty result", async () => {
    const { extractLayoutData } = await loadModule();
    const { positions, dimensions } = extractLayoutData({ children: [] });
    expect(positions.size).toBe(0);
    expect(dimensions.size).toBe(0);
  });
});

describe("assembleFlowNodes", () => {
  test("places job nodes before task nodes in output array", async () => {
    const { groupNodesByJob, assembleFlowNodes } = await loadModule();
    const groups = groupNodesByJob(SINGLE_JOB_GRAPH.nodes);

    const positions = new Map([
      ["resources.jobs.etl", { x: 0, y: 0 }],
      ["resources.jobs.etl::extract", { x: 20, y: 40 }],
      ["resources.jobs.etl::transform", { x: 240, y: 40 }],
    ]);
    const dimensions = new Map([["resources.jobs.etl", { width: 500, height: 200 }]]);

    const nodes = assembleFlowNodes(groups, positions, dimensions);

    const jobIndex = nodes.findIndex((n) => n.type === "job");
    const firstTaskIndex = nodes.findIndex((n) => n.type === "task");
    expect(jobIndex).toBe(0);
    expect(firstTaskIndex).toBeGreaterThan(jobIndex);
  });

  test("task nodes get parentId set to their resourceKey", async () => {
    const { groupNodesByJob, assembleFlowNodes } = await loadModule();
    const groups = groupNodesByJob(SINGLE_JOB_GRAPH.nodes);

    const positions = new Map([
      ["resources.jobs.etl", { x: 0, y: 0 }],
      ["resources.jobs.etl::extract", { x: 20, y: 40 }],
      ["resources.jobs.etl::transform", { x: 240, y: 40 }],
    ]);
    const dimensions = new Map([["resources.jobs.etl", { width: 500, height: 200 }]]);

    const nodes = assembleFlowNodes(groups, positions, dimensions);
    const taskNodes = nodes.filter((n) => n.type === "task");

    for (const task of taskNodes) {
      expect(task.parentId).toBe("resources.jobs.etl");
      expect(task.extent).toBe("parent");
    }
  });

  test("job nodes get style with width and height", async () => {
    const { groupNodesByJob, assembleFlowNodes } = await loadModule();
    const groups = groupNodesByJob(SINGLE_JOB_GRAPH.nodes);

    const positions = new Map([
      ["resources.jobs.etl", { x: 0, y: 0 }],
      ["resources.jobs.etl::extract", { x: 20, y: 40 }],
      ["resources.jobs.etl::transform", { x: 240, y: 40 }],
    ]);
    const dimensions = new Map([["resources.jobs.etl", { width: 500, height: 200 }]]);

    const nodes = assembleFlowNodes(groups, positions, dimensions);
    const jobNode = nodes.find((n) => n.type === "job");

    // React Flow's Node.style is CSSProperties; bracket access requires Record cast.
    const style = jobNode?.style as Record<string, unknown>;
    expect(style["width"]).toBe(500);
    expect(style["height"]).toBe(200);
  });
});

describe("toFlowEdges", () => {
  test("converts graph edges to React Flow edges", async () => {
    const { toFlowEdges } = await loadModule();
    const edges = toFlowEdges(SINGLE_JOB_GRAPH.edges);

    expect(edges).toHaveLength(1);
    expect(edges[0]?.source).toBe("resources.jobs.etl::extract");
    expect(edges[0]?.target).toBe("resources.jobs.etl::transform");
  });

  test("preserves edge labels", async () => {
    const { toFlowEdges } = await loadModule();
    const edges = toFlowEdges([
      { id: "e1", source: "a", target: "b", label: "depends_on", diffState: "unchanged" },
    ]);
    expect(edges[0]?.label).toBe("depends_on");
  });

  test("applies edge style from diffState", async () => {
    const { toFlowEdges } = await loadModule();
    const edges = toFlowEdges([
      { id: "e1", source: "a", target: "b", label: undefined, diffState: "added" },
      { id: "e2", source: "c", target: "d", label: undefined, diffState: "removed" },
      { id: "e3", source: "e", target: "f", label: undefined, diffState: "unchanged" },
    ]);

    expect(edges[0]?.style).toEqual({
      stroke: "var(--edge-added)",
      opacity: 1,
      strokeDasharray: undefined,
    });
    expect(edges[1]?.style).toEqual({
      stroke: "var(--edge-removed)",
      opacity: 1,
      strokeDasharray: "6 4",
    });
    expect(edges[2]?.style).toEqual({
      stroke: "var(--edge-unchanged)",
      opacity: 1,
      strokeDasharray: undefined,
    });
  });
});

describe("toLateralFlowEdges", () => {
  const nodeLayouts = new Map([
    ["a", { position: { x: 0, y: 0 }, height: 50 }],
    ["b", { position: { x: 300, y: 0 }, height: 50 }],
  ]);

  test("applies lateral edge style to graph edges", async () => {
    const { toLateralFlowEdges } = await loadModule();
    const edges = toLateralFlowEdges(
      [{ id: "a→b", source: "a", target: "b", label: undefined, diffState: "unchanged" }],
      nodeLayouts,
    );

    expect(edges).toHaveLength(1);
    expect(edges[0]?.style).toEqual({
      stroke: "var(--edge-lateral)",
      opacity: 0.7,
      strokeDasharray: undefined,
      strokeWidth: 2.5,
    });
  });

  test("uses straight edge type with shortest-path lateral handles", async () => {
    const { toLateralFlowEdges } = await loadModule();
    const edges = toLateralFlowEdges(
      [{ id: "a→b", source: "a", target: "b", label: undefined, diffState: "unchanged" }],
      nodeLayouts,
    );

    expect(edges[0]?.type).toBe("straight");
    expect(edges[0]?.sourceHandle).toMatch(/^lateral-/);
    expect(edges[0]?.targetHandle).toMatch(/^lateral-/);
    expect(edges[0]?.zIndex).toBe(10);
  });

  test("chooses vertical handles when nodes are vertically separated", async () => {
    const { toLateralFlowEdges } = await loadModule();
    const verticalLayouts = new Map([
      ["a", { position: { x: 0, y: 0 }, height: 50 }],
      ["b", { position: { x: 0, y: 200 }, height: 50 }],
    ]);
    const edges = toLateralFlowEdges(
      [{ id: "a→b", source: "a", target: "b", label: undefined, diffState: "unchanged" }],
      verticalLayouts,
    );

    expect(edges[0]?.sourceHandle).toBe("lateral-bottom-out");
    expect(edges[0]?.targetHandle).toBe("lateral-top");
  });

  test("chooses top-out to bottom handles when source is below target", async () => {
    const { toLateralFlowEdges } = await loadModule();
    const layouts = new Map([
      ["a", { position: { x: 0, y: 200 }, height: 50 }],
      ["b", { position: { x: 0, y: 0 }, height: 50 }],
    ]);
    const edges = toLateralFlowEdges(
      [{ id: "a→b", source: "a", target: "b", label: undefined, diffState: "unchanged" }],
      layouts,
    );

    expect(edges[0]?.sourceHandle).toBe("lateral-top-out");
    expect(edges[0]?.targetHandle).toBe("lateral-bottom");
  });

  test("breaks tie by iteration order when nodes share the same y position", async () => {
    const { toLateralFlowEdges } = await loadModule();
    const edges = toLateralFlowEdges(
      [{ id: "a→b", source: "a", target: "b", label: undefined, diffState: "unchanged" }],
      nodeLayouts,
    );

    expect(edges[0]?.sourceHandle).toBe("lateral-top-out");
    expect(edges[0]?.targetHandle).toBe("lateral-top");
  });

  test("chooses bottom-out to bottom handles with different node heights", async () => {
    const { toLateralFlowEdges } = await loadModule();
    const layouts = new Map([
      ["a", { position: { x: 0, y: 0 }, height: 50 }],
      ["b", { position: { x: 300, y: 10 }, height: 40 }],
    ]);
    const edges = toLateralFlowEdges(
      [{ id: "a→b", source: "a", target: "b", label: undefined, diffState: "unchanged" }],
      layouts,
    );

    expect(edges[0]?.sourceHandle).toBe("lateral-bottom-out");
    expect(edges[0]?.targetHandle).toBe("lateral-bottom");
  });

  test("skips edges when node positions are missing", async () => {
    const { toLateralFlowEdges } = await loadModule();
    const edges = toLateralFlowEdges(
      [{ id: "a→c", source: "a", target: "c", label: undefined, diffState: "unchanged" }],
      nodeLayouts,
    );

    expect(edges).toHaveLength(0);
  });

  test("returns empty array for empty input", async () => {
    const { toLateralFlowEdges } = await loadModule();
    const edges = toLateralFlowEdges([], nodeLayouts);

    expect(edges).toHaveLength(0);
  });
});

describe("toReactFlowElements", () => {
  test("returns empty nodes and edges for empty graph", async () => {
    const { toReactFlowElements } = await loadModule();
    const result = await toReactFlowElements({ nodes: [], edges: [] });
    expect(result.nodes).toHaveLength(0);
    expect(result.edges).toHaveLength(0);
  });
});
