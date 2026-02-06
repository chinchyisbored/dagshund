import type { Edge, Node } from "@xyflow/react";
import ELK from "elkjs/lib/elk.bundled.js";
import type { GraphNode, PlanGraph } from "../types/graph-types.ts";

const NODE_WIDTH = 200;
const NODE_HEIGHT_JOB = 60;
const NODE_HEIGHT_TASK = 50;

const elk = new ELK();

const getNodeHeight = (node: GraphNode): number =>
  node.nodeKind === "job" ? NODE_HEIGHT_JOB : NODE_HEIGHT_TASK;

/** Compute elk layout positions for all nodes. */
const computeLayout = async (
  graph: PlanGraph,
): Promise<ReadonlyMap<string, { readonly x: number; readonly y: number }>> => {
  const elkGraph = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "DOWN",
      "elk.spacing.nodeNode": "50",
      "elk.layered.spacing.nodeNodeBetweenLayers": "70",
    },
    children: graph.nodes.map((node) => ({
      id: node.id,
      width: NODE_WIDTH,
      height: getNodeHeight(node),
    })),
    edges: graph.edges.map((edge) => ({
      id: edge.id,
      sources: [edge.source],
      targets: [edge.target],
    })),
  };

  const layoutResult = await elk.layout(elkGraph);

  const positions = new Map<string, { readonly x: number; readonly y: number }>();
  for (const child of layoutResult.children ?? []) {
    positions.set(child.id, {
      x: child.x ?? 0,
      y: child.y ?? 0,
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

/** Convert a PlanGraph to React Flow nodes and edges with elk layout. */
export const toReactFlowElements = async (
  graph: PlanGraph,
): Promise<{ readonly nodes: readonly Node[]; readonly edges: readonly Edge[] }> => {
  if (graph.nodes.length === 0) {
    return { nodes: [], edges: [] };
  }

  const positions = await computeLayout(graph);

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
