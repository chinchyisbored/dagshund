import type { Edge, Node } from "@xyflow/react";
import type { PhantomContext } from "../types/phantom-context.ts";
import { getNodeData } from "./node-data.ts";
import { extractTypeBadge } from "./resource-key.ts";

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
            .filter((e) => e.target === nodeId && e.id.startsWith("lateral::"))
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
        resourceType: extractTypeBadge(data.resourceKey),
      };
    });

  return { sources };
};
