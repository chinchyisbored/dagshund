import type { Edge } from "@xyflow/react";

/** Collect all node IDs that participate in any lateral edge. */
export const collectLateralNodeIds = (
  lateralEdges: readonly Edge[],
): ReadonlySet<string> | null => {
  if (lateralEdges.length === 0) return null;
  const ids = new Set<string>();
  for (const edge of lateralEdges) {
    ids.add(edge.source);
    ids.add(edge.target);
  }
  return ids;
};

/** Filter lateral edges to only those touching the isolated node. */
export const filterIsolatedLateralEdges = (
  lateralEdges: readonly Edge[],
  isolatedLateralNodeId: string | null,
): readonly Edge[] =>
  isolatedLateralNodeId !== null
    ? lateralEdges.filter(
        (e) => e.source === isolatedLateralNodeId || e.target === isolatedLateralNodeId,
      )
    : [];

/** Collect the isolated node + its lateral neighbors for dimming. */
export const collectIsolatedLateralIds = (
  lateralEdges: readonly Edge[],
  isolatedLateralNodeId: string | null,
): ReadonlySet<string> | null => {
  if (isolatedLateralNodeId === null) return null;
  const ids = new Set<string>([isolatedLateralNodeId]);
  for (const edge of lateralEdges) {
    if (edge.source === isolatedLateralNodeId) ids.add(edge.target);
    if (edge.target === isolatedLateralNodeId) ids.add(edge.source);
  }
  return ids;
};

/** Build a map of node ID → active lateral handle IDs for rendering. */
export const buildLateralHandlesByNode = (
  activeLateralEdges: readonly Edge[],
): ReadonlyMap<string, ReadonlySet<string>> | null => {
  if (activeLateralEdges.length === 0) return null;
  const map = new Map<string, Set<string>>();
  const addHandle = (nodeId: string, handleId: string | null | undefined) => {
    if (handleId === null || handleId === undefined) return;
    let handles = map.get(nodeId);
    if (handles === undefined) {
      handles = new Set();
      map.set(nodeId, handles);
    }
    handles.add(handleId);
  };
  for (const edge of activeLateralEdges) {
    addHandle(edge.source, edge.sourceHandle);
    addHandle(edge.target, edge.targetHandle);
  }
  return map;
};
