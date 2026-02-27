import type { Edge } from "@xyflow/react";
import { useMemo } from "react";

type LateralEdgeState = {
  /** All node IDs that participate in any lateral edge — for icon visibility. */
  readonly lateralNodeIds: ReadonlySet<string> | null;
  /** Active lateral edges to include in the visible edge set. */
  readonly activeLateralEdges: readonly Edge[];
  /** Isolated node + its lateral neighbors — for dimming. */
  readonly isolatedLateralIds: ReadonlySet<string> | null;
  /** Which handles to show per node for active lateral edges. */
  readonly lateralHandlesByNode: ReadonlyMap<string, ReadonlySet<string>> | null;
};

/** Derive all lateral-edge state from the raw edges, toggle, and isolation selection. */
export const useLateralEdgeState = (
  lateralEdges: readonly Edge[],
  showLateralEdges: boolean,
  isolatedLateralNodeId: string | null,
): LateralEdgeState => {
  const lateralNodeIds = useMemo((): ReadonlySet<string> | null => {
    if (lateralEdges.length === 0) return null;
    const ids = new Set<string>();
    for (const edge of lateralEdges) {
      ids.add(edge.source);
      ids.add(edge.target);
    }
    return ids;
  }, [lateralEdges]);

  const isolatedLateralEdges = useMemo(
    (): readonly Edge[] =>
      isolatedLateralNodeId !== null
        ? lateralEdges.filter(
            (e) => e.source === isolatedLateralNodeId || e.target === isolatedLateralNodeId,
          )
        : [],
    [lateralEdges, isolatedLateralNodeId],
  );

  const activeLateralEdges = useMemo(
    (): readonly Edge[] => (showLateralEdges ? lateralEdges : isolatedLateralEdges),
    [showLateralEdges, lateralEdges, isolatedLateralEdges],
  );

  const isolatedLateralIds = useMemo((): ReadonlySet<string> | null => {
    if (isolatedLateralNodeId === null) return null;
    const ids = new Set<string>([isolatedLateralNodeId]);
    for (const edge of lateralEdges) {
      if (edge.source === isolatedLateralNodeId) ids.add(edge.target);
      if (edge.target === isolatedLateralNodeId) ids.add(edge.source);
    }
    return ids;
  }, [lateralEdges, isolatedLateralNodeId]);

  const lateralHandlesByNode = useMemo((): ReadonlyMap<string, ReadonlySet<string>> | null => {
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
  }, [activeLateralEdges]);

  return { lateralNodeIds, activeLateralEdges, isolatedLateralIds, lateralHandlesByNode };
};
