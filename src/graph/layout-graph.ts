import type { Edge, Node } from "@xyflow/react";
import ELK from "elkjs/lib/elk.bundled.js";
import { getEdgeStyle, resolveEdgeDiffState } from "../components/diff-state-styles.ts";
import type { DiffState } from "../types/diff-state.ts";
import type { GraphNode, PlanGraph } from "../types/graph-types.ts";

export const NODE_WIDTH = 200;
const NODE_HEIGHT_TASK = 50;

const JOB_PADDING_TOP = 40;
const JOB_PADDING_SIDE = 20;
const JOB_PADDING_BOTTOM = 20;

/** Lazily instantiate ELK to avoid Worker creation at import time (breaks Bun test runner). */
let elkInstance: InstanceType<typeof ELK> | undefined;
const getElk = (): InstanceType<typeof ELK> => {
  if (!elkInstance) {
    elkInstance = new ELK();
  }
  return elkInstance;
};

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

/** Build an ELK compound graph with jobs as parents and tasks as children. */
export const buildElkCompoundGraph = (graph: PlanGraph) => {
  const groups = groupNodesByJob(graph.nodes);

  return {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.spacing.nodeNode": "60",
      "elk.layered.spacing.nodeNodeBetweenLayers": "80",
    },
    children: groups.map((group) => ({
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
      children: group.tasks.map((task) => ({
        id: task.id,
        width: NODE_WIDTH,
        height: NODE_HEIGHT_TASK,
      })),
      edges: graph.edges
        .filter(
          (edge) =>
            group.tasks.some((t) => t.id === edge.source) &&
            group.tasks.some((t) => t.id === edge.target),
        )
        .map((edge) => ({
          id: edge.id,
          sources: [edge.source],
          targets: [edge.target],
        })),
    })),
    edges: collectCrossJobEdges(graph.edges),
  };
};

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
  data: {
    label: node.label,
    diffState: node.diffState,
    nodeKind: node.nodeKind,
    resourceKey: node.resourceKey,
    taskKey: node.taskKey,
    changes: node.changes,
    resourceState: node.resourceState,
  },
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
  data: {
    label: node.label,
    diffState: node.diffState,
    nodeKind: node.nodeKind,
    resourceKey: node.resourceKey,
    taskKey: node.taskKey,
    changes: node.changes,
    resourceState: node.resourceState,
  },
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

/** Build a lookup from node ID to diff state. */
const buildDiffStateLookup = (nodes: readonly GraphNode[]): ReadonlyMap<string, DiffState> =>
  new Map(nodes.map((node) => [node.id, node.diffState]));

/** Convert graph edges to React Flow edges with diff-state-derived colors. */
export const toFlowEdges = (
  edges: PlanGraph["edges"],
  nodes: readonly GraphNode[],
): readonly Edge[] => {
  const diffStates = buildDiffStateLookup(nodes);
  return edges.map((edge) => {
    const sourceDiff = diffStates.get(edge.source) ?? "unchanged";
    const targetDiff = diffStates.get(edge.target) ?? "unchanged";
    const edgeDiff = resolveEdgeDiffState(sourceDiff, targetDiff);
    const style = getEdgeStyle(edgeDiff);
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      label: edge.label,
      type: "bezier",
      style: { stroke: style.stroke, opacity: style.opacity },
    };
  });
};

/** Convert a PlanGraph to React Flow nodes and edges with ELK compound layout. */
export const toReactFlowElements = async (
  graph: PlanGraph,
): Promise<{ readonly nodes: readonly Node[]; readonly edges: readonly Edge[] }> => {
  if (graph.nodes.length === 0) {
    return { nodes: [], edges: [] };
  }

  const elkGraph = buildElkCompoundGraph(graph);
  const elkResult = await getElk().layout(elkGraph);
  const { positions, dimensions } = extractLayoutData(elkResult);
  const groups = groupNodesByJob(graph.nodes);

  return {
    nodes: assembleFlowNodes(groups, positions, dimensions),
    edges: toFlowEdges(graph.edges, graph.nodes),
  };
};
