import type { Edge, Node } from "@xyflow/react";
import type { LateralContext } from "../types/lateral-context.ts";
import type { PhantomContext } from "../types/phantom-context.ts";
import { getNodeData } from "./node-data.ts";
import { extractPhantomBadge, LATERAL_EDGE_PREFIX } from "./resource-key.ts";

/** Returns the given node ID plus all node IDs sharing an edge with it.
 *  When a job (parent) node is targeted, its child tasks are included too. */
export const buildConnectedNodeIds = (
  nodes: readonly Node[],
  edges: readonly Edge[],
  targetNodeId: string,
): ReadonlySet<string> => {
  const connected = new Set<string>([targetNodeId]);
  for (const edge of edges) {
    if (edge.source === targetNodeId) connected.add(edge.target);
    if (edge.target === targetNodeId) connected.add(edge.source);
  }
  for (const node of nodes) {
    if (node.parentId === targetNodeId) connected.add(node.id);
  }
  return connected;
};

/** Derive inference context for a phantom node from its outgoing edges.
 *  Every outgoing edge points to a child/referenced node that caused the phantom to exist. */
export const resolvePhantomContext = (
  nodeId: string,
  nodes: readonly Node[],
  edges: readonly Edge[],
): PhantomContext | undefined => {
  // Hierarchy phantoms: inferred from their children (outgoing hierarchy edges)
  const childIds = new Set(edges.filter((e) => e.source === nodeId).map((e) => e.target));

  // Leaf phantoms: inferred from lateral edge sources (incoming lateral edges)
  const lateralSourceIds =
    childIds.size === 0
      ? new Set(
          edges
            .filter((e) => e.target === nodeId && e.id.startsWith(LATERAL_EDGE_PREFIX))
            .map((e) => e.source),
        )
      : new Set<string>();

  const relatedIds = childIds.size > 0 ? childIds : lateralSourceIds;
  if (relatedIds.size === 0) return undefined;

  const sources = nodes
    .filter((n) => relatedIds.has(n.id))
    .map((n) => {
      const data = getNodeData(n);
      return {
        label: data.label,
        resourceKey: data.resourceKey,
        resourceType: extractPhantomBadge(data.resourceKey),
      };
    });

  return { sources };
};

/** Derive lateral dependency context for a node from lateral edges.
 *  source→target means "source depends on target". */
export const resolveLateralContext = (
  nodeId: string,
  nodes: readonly Node[],
  lateralEdges: readonly Edge[],
): LateralContext | undefined => {
  const dependsOnIds = new Set<string>();
  const dependedOnByIds = new Set<string>();

  for (const edge of lateralEdges) {
    if (!edge.id.startsWith(LATERAL_EDGE_PREFIX)) continue;
    if (edge.source === nodeId) dependsOnIds.add(edge.target);
    if (edge.target === nodeId) dependedOnByIds.add(edge.source);
  }

  if (dependsOnIds.size === 0 && dependedOnByIds.size === 0) return undefined;

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  const toEntry = (id: string) => {
    const node = nodeMap.get(id);
    if (node === undefined) return undefined;
    const data = getNodeData(node);
    return {
      nodeId: id,
      label: data.label,
      resourceKey: data.resourceKey,
      resourceType: extractPhantomBadge(data.resourceKey),
      diffState: data.diffState,
    };
  };

  const dependsOn = [...dependsOnIds].map(toEntry).filter((e) => e !== undefined);
  const dependedOnBy = [...dependedOnByIds].map(toEntry).filter((e) => e !== undefined);

  if (dependsOn.length === 0 && dependedOnBy.length === 0) return undefined;

  return { dependsOn, dependedOnBy };
};
