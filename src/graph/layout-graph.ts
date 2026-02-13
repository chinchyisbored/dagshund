import type { Edge, Node } from "@xyflow/react";
import ELK from "elkjs/lib/elk.bundled.js";
import { getEdgeStyle } from "../components/diff-state-styles.ts";
import type { DagNodeData, GraphNode, PlanGraph } from "../types/graph-types.ts";

/** Lazily instantiate ELK — deferred to avoid Worker creation at import time (breaks Bun test runner). */
const getElk = (() => {
  let instance: InstanceType<typeof ELK> | undefined;
  return (): InstanceType<typeof ELK> => {
    if (!instance) {
      instance = new ELK();
    }
    return instance;
  };
})();

export const NODE_WIDTH = 200;
const NODE_HEIGHT_TASK = 50;
const NODE_HEIGHT_RESOURCE = 50;
const NODE_HEIGHT_GROUP = 40;

const JOB_PADDING_TOP = 40;
const JOB_PADDING_SIDE = 20;
const JOB_PADDING_BOTTOM = 20;

export type JobGroup = {
  readonly job: GraphNode;
  readonly tasks: readonly GraphNode[];
};

/** Group graph nodes by job, pairing each job with its child tasks. */
export const groupNodesByJob = (nodes: readonly GraphNode[]): readonly JobGroup[] => {
  const jobMap = new Map<string, { job: GraphNode; tasks: GraphNode[] }>();

  for (const node of nodes) {
    if (node.nodeKind === "job") {
      const existing = jobMap.get(node.resourceKey);
      if (existing) {
        existing.job = node;
      } else {
        jobMap.set(node.resourceKey, { job: node, tasks: [] });
      }
    }
  }

  for (const node of nodes) {
    if (node.nodeKind === "task") {
      const group = jobMap.get(node.resourceKey);
      if (group) {
        group.tasks.push(node);
      }
    }
  }

  return [...jobMap.values()];
};

/** Extract the parent job ID from a node ID (task IDs contain "::", job IDs don't). */
const parentJobId = (nodeId: string): string => {
  const separator = nodeId.indexOf("::");
  return separator === -1 ? nodeId : nodeId.substring(0, separator);
};

/** Collect cross-hierarchy edges (source and target in different jobs) mapped to job-level for ELK. */
const collectCrossJobEdges = (
  edges: PlanGraph["edges"],
): { id: string; sources: string[]; targets: string[] }[] => {
  const seen = new Set<string>();
  return edges.flatMap((edge) => {
    const sourceJob = parentJobId(edge.source);
    const targetJob = parentJobId(edge.target);
    if (sourceJob === targetJob) return [];
    const pairKey = `${sourceJob}→${targetJob}`;
    if (seen.has(pairKey)) return [];
    seen.add(pairKey);
    return [{ id: `elk-${pairKey}`, sources: [sourceJob], targets: [targetJob] }];
  });
};

/** Topologically sort tasks within a job so ELK model order matches dependency flow. */
export const topologicalSortTasks = (
  tasks: readonly GraphNode[],
  edges: readonly { readonly source: string; readonly target: string }[],
): readonly GraphNode[] => {
  const taskIds = new Set(tasks.map((t) => t.id));
  const intraEdges = edges.filter((e) => taskIds.has(e.source) && taskIds.has(e.target));

  const adjacency = new Map<string, string[]>();
  const inDegree = new Map<string, number>();

  for (const task of tasks) {
    adjacency.set(task.id, []);
    inDegree.set(task.id, 0);
  }

  for (const edge of intraEdges) {
    adjacency.get(edge.source)!.push(edge.target);
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
  }

  const queue: string[] = [];
  for (const task of tasks) {
    if ((inDegree.get(task.id) ?? 0) === 0) {
      queue.push(task.id);
    }
  }

  const sortedIds: string[] = [];
  let front = 0;
  while (front < queue.length) {
    // bounds check above guarantees this element exists
    const current = queue[front++] as string;
    sortedIds.push(current);
    for (const neighbor of adjacency.get(current) ?? []) {
      const newDegree = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, newDegree);
      if (newDegree === 0) {
        queue.push(neighbor);
      }
    }
  }

  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const sorted = sortedIds.map((id) => taskById.get(id)!);

  // Append any disconnected tasks not reached by BFS in original order
  const sortedSet = new Set(sortedIds);
  for (const task of tasks) {
    if (!sortedSet.has(task.id)) {
      sorted.push(task);
    }
  }

  return sorted;
};

/** Build an ELK compound graph with jobs as parents and tasks as children. */
export const buildElkCompoundGraph = (
  groups: readonly JobGroup[],
  edges: PlanGraph["edges"],
) => ({
  id: "root",
  layoutOptions: {
    "elk.algorithm": "layered",
    "elk.direction": "RIGHT",
    "elk.separateConnectedComponents": "false",
    "elk.spacing.nodeNode": "60",
    "elk.layered.spacing.nodeNodeBetweenLayers": "80",
    "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
    "elk.layered.crossingMinimization.forceNodeModelOrder": "true",
  },
  children: [...groups].sort((a, b) => a.job.label.localeCompare(b.job.label)).map((group) => {
    const taskIds = new Set(group.tasks.map((t) => t.id));
    return {
      id: group.job.id,
      layoutOptions: {
        "elk.algorithm": "layered",
        "elk.direction": "RIGHT",
        "elk.hierarchyHandling": "SEPARATE_CHILDREN",
        "elk.spacing.nodeNode": "40",
        "elk.layered.spacing.nodeNodeBetweenLayers": "60",
        "elk.spacing.edgeNode": "20",
        "elk.layered.spacing.edgeNodeBetweenLayers": "20",
        "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
        "elk.layered.nodePlacement.bk.fixedAlignment": "BALANCED",
        "elk.layered.considerModelOrder.portModelOrder": "true",
        "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
        "elk.layered.crossingMinimization.forceNodeModelOrder": "true",
        "elk.layered.compaction.connectedComponents": "true",
        "elk.layered.compaction.postCompaction.strategy": "EDGE_LENGTH",
        "elk.layered.cycleBreaking.strategy": "MODEL_ORDER",
        "elk.padding": `[top=${JOB_PADDING_TOP},left=${JOB_PADDING_SIDE},bottom=${JOB_PADDING_BOTTOM},right=${JOB_PADDING_SIDE}]`,
      },
      children: topologicalSortTasks(group.tasks, edges).map((task) => ({
        id: task.id,
        width: NODE_WIDTH,
        height: NODE_HEIGHT_TASK,
      })),
      edges: edges
        .filter((edge) => taskIds.has(edge.source) && taskIds.has(edge.target))
        .map((edge) => ({
          id: edge.id,
          sources: [edge.source],
          targets: [edge.target],
        })),
    };
  }),
  edges: collectCrossJobEdges(edges),
});

type ElkLayoutResult = {
  readonly children?: ReadonlyArray<{
    readonly id: string;
    readonly x?: number;
    readonly y?: number;
    readonly width?: number;
    readonly height?: number;
    readonly children?: ReadonlyArray<{
      readonly id: string;
      readonly x?: number;
      readonly y?: number;
    }>;
  }>;
};

/** Extract layout positions and job dimensions from ELK result. */
export const extractLayoutData = (
  elkResult: ElkLayoutResult,
): {
  readonly positions: ReadonlyMap<string, { readonly x: number; readonly y: number }>;
  readonly dimensions: ReadonlyMap<string, { readonly width: number; readonly height: number }>;
} => {
  const positions = new Map<string, { readonly x: number; readonly y: number }>();
  const dimensions = new Map<string, { readonly width: number; readonly height: number }>();

  for (const jobElk of elkResult.children ?? []) {
    positions.set(jobElk.id, { x: jobElk.x ?? 0, y: jobElk.y ?? 0 });
    dimensions.set(jobElk.id, {
      width: jobElk.width ?? 0,
      height: jobElk.height ?? 0,
    });

    for (const taskElk of jobElk.children ?? []) {
      positions.set(taskElk.id, { x: taskElk.x ?? 0, y: taskElk.y ?? 0 });
    }
  }

  return { positions, dimensions };
};

/** Build a descriptive aria-label for screen readers, e.g. "added task: ingest_raw_data". */
const buildAriaLabel = (node: GraphNode): string =>
  `${node.diffState} ${node.nodeKind}: ${node.label}`;

/** Strip the `id` field from a GraphNode, producing the data payload for React Flow nodes. */
const toNodeData = (node: GraphNode): DagNodeData => {
  const { id: _, ...data } = node;
  return data;
};

/** Convert a job GraphNode to a React Flow container node. */
export const toJobFlowNode = (
  node: GraphNode,
  position: { readonly x: number; readonly y: number },
  dimension: { readonly width: number; readonly height: number },
): Node => ({
  id: node.id,
  type: node.nodeKind,
  position: { x: position.x, y: position.y },
  style: { width: dimension.width, height: dimension.height },
  data: toNodeData(node),
  ariaLabel: buildAriaLabel(node),
});

/** Convert a task GraphNode to a React Flow child node inside its job. */
export const toTaskFlowNode = (
  node: GraphNode,
  position: { readonly x: number; readonly y: number },
): Node => ({
  id: node.id,
  type: node.nodeKind,
  position: { x: position.x, y: position.y },
  parentId: node.resourceKey,
  extent: "parent" as const,
  data: { ...toNodeData(node), taskChangeSummary: undefined },
  ariaLabel: buildAriaLabel(node),
});

/** Assemble React Flow nodes from layout data, with jobs before their children. */
export const assembleFlowNodes = (
  groups: readonly JobGroup[],
  positions: ReadonlyMap<string, { readonly x: number; readonly y: number }>,
  dimensions: ReadonlyMap<string, { readonly width: number; readonly height: number }>,
): readonly Node[] => {
  const nodes: Node[] = [];
  for (const group of groups) {
    const jobPosition = positions.get(group.job.id) ?? { x: 0, y: 0 };
    const jobDimension = dimensions.get(group.job.id) ?? { width: 0, height: 0 };
    nodes.push(toJobFlowNode(group.job, jobPosition, jobDimension));

    for (const task of group.tasks) {
      const taskPosition = positions.get(task.id) ?? { x: 0, y: 0 };
      nodes.push(toTaskFlowNode(task, taskPosition));
    }
  }
  return nodes;
};

/** Convert graph edges to React Flow edges with diff-state-derived colors. */
export const toFlowEdges = (edges: PlanGraph["edges"]): readonly Edge[] =>
  edges.map((edge) => {
    const style = getEdgeStyle(edge.diffState);
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      label: edge.label,
      type: "bezier",
      style: { stroke: style.stroke, opacity: style.opacity, strokeDasharray: style.strokeDasharray },
    };
  });

/** Convert a PlanGraph to React Flow nodes and edges with ELK compound layout. */
export const toReactFlowElements = async (
  graph: PlanGraph,
): Promise<{ readonly nodes: readonly Node[]; readonly edges: readonly Edge[] }> => {
  if (graph.nodes.length === 0) {
    return { nodes: [], edges: [] };
  }

  const groups = groupNodesByJob(graph.nodes);
  const elkGraph = buildElkCompoundGraph(groups, graph.edges);
  const elkResult = await getElk().layout(elkGraph);
  const { positions, dimensions } = extractLayoutData(elkResult);

  return {
    nodes: assembleFlowNodes(groups, positions, dimensions),
    edges: toFlowEdges(graph.edges),
  };
};

/** Convert a GraphNode to a React Flow node at the given position (flat, no parent). */
const toFlatFlowNode = (
  node: GraphNode,
  position: { readonly x: number; readonly y: number },
): Node => ({
  id: node.id,
  type: node.nodeKind,
  position: { x: position.x, y: position.y },
  data: toNodeData(node),
  ariaLabel: buildAriaLabel(node),
});

/** Flat ELK layout for resource graphs (left-to-right, no compound hierarchy). */
export const layoutResourceGraph = async (
  graph: PlanGraph,
): Promise<{ readonly nodes: readonly Node[]; readonly edges: readonly Edge[] }> => {
  if (graph.nodes.length === 0) {
    return { nodes: [], edges: [] };
  }

  const elkGraph = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.spacing.nodeNode": "40",
      "elk.layered.spacing.nodeNodeBetweenLayers": "80",
      "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
      "elk.layered.nodePlacement.bk.fixedAlignment": "BALANCED",
    },
    children: graph.nodes.map((node) => ({
      id: node.id,
      width: NODE_WIDTH,
      height: node.nodeKind === "resource-group" ? NODE_HEIGHT_GROUP : NODE_HEIGHT_RESOURCE,
    })),
    edges: graph.edges.map((edge) => ({
      id: edge.id,
      sources: [edge.source],
      targets: [edge.target],
    })),
  };

  const elkResult = await getElk().layout(elkGraph);

  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  const flowNodes: Node[] = [];

  for (const child of elkResult.children ?? []) {
    const graphNode = nodeById.get(child.id);
    if (graphNode !== undefined) {
      flowNodes.push(toFlatFlowNode(graphNode, { x: child.x ?? 0, y: child.y ?? 0 }));
    }
  }

  return {
    nodes: flowNodes,
    edges: toFlowEdges(graph.edges),
  };
};
