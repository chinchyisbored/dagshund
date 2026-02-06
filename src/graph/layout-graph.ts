import dagre from "../vendor/dagre.js";
import type { Node, Edge } from "@xyflow/react";
import type { PlanGraph, GraphNode } from "../types/graph-types.ts";

const NODE_WIDTH = 200;
const NODE_HEIGHT_JOB = 60;
const NODE_HEIGHT_TASK = 50;

const getNodeHeight = (node: GraphNode): number =>
  node.nodeKind === "job" ? NODE_HEIGHT_JOB : NODE_HEIGHT_TASK;

/** Compute dagre layout positions for all nodes. */
const computeLayout = (
  graph: PlanGraph,
): ReadonlyMap<string, { readonly x: number; readonly y: number }> => {
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));
  dagreGraph.setGraph({ rankdir: "TB", nodesep: 50, ranksep: 70 });

  for (const node of graph.nodes) {
    dagreGraph.setNode(node.id, {
      width: NODE_WIDTH,
      height: getNodeHeight(node),
    });
  }
  for (const edge of graph.edges) {
    dagreGraph.setEdge(edge.source, edge.target);
  }

  dagre.layout(dagreGraph);

  const positions = new Map<string, { readonly x: number; readonly y: number }>();
  for (const node of graph.nodes) {
    const dagreNode = dagreGraph.node(node.id);
    positions.set(node.id, {
      x: dagreNode.x - NODE_WIDTH / 2,
      y: dagreNode.y - getNodeHeight(node) / 2,
    });
  }
  return positions;
};

/** Convert a GraphNode to a React Flow Node with position. */
const toReactFlowNode = (
  node: GraphNode,
  position: { readonly x: number; readonly y: number },
): Node => ({
  id: node.id,
  type: node.nodeKind,
  position: { x: position.x, y: position.y },
  data: {
    label: node.label,
    diffState: node.diffState,
    nodeKind: node.nodeKind,
    resourceKey: node.resourceKey,
    taskKey: node.taskKey,
    changes: node.changes,
  },
});

/** Convert a PlanGraph to React Flow nodes and edges with dagre layout. */
export const toReactFlowElements = (
  graph: PlanGraph,
): { readonly nodes: readonly Node[]; readonly edges: readonly Edge[] } => {
  if (graph.nodes.length === 0) {
    return { nodes: [], edges: [] };
  }

  const positions = computeLayout(graph);

  const nodes = graph.nodes.map((node) =>
    toReactFlowNode(node, positions.get(node.id) ?? { x: 0, y: 0 }),
  );

  const edges: readonly Edge[] = graph.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    label: edge.label,
  }));

  return { nodes, edges };
};
