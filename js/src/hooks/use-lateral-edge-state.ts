import type { Edge } from "@xyflow/react";
import { useMemo } from "react";
import {
  buildLateralHandlesByNode,
  collectIsolatedLateralIds,
  collectLateralNodeIds,
  filterIsolatedLateralEdges,
} from "../utils/lateral-sets.ts";

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
  const lateralNodeIds = useMemo(() => collectLateralNodeIds(lateralEdges), [lateralEdges]);

  const isolatedLateralEdges = useMemo(
    () => filterIsolatedLateralEdges(lateralEdges, isolatedLateralNodeId),
    [lateralEdges, isolatedLateralNodeId],
  );

  const activeLateralEdges = useMemo(
    (): readonly Edge[] => (showLateralEdges ? lateralEdges : isolatedLateralEdges),
    [showLateralEdges, lateralEdges, isolatedLateralEdges],
  );

  const isolatedLateralIds = useMemo(
    () => collectIsolatedLateralIds(lateralEdges, isolatedLateralNodeId),
    [lateralEdges, isolatedLateralNodeId],
  );

  const lateralHandlesByNode = useMemo(
    () => buildLateralHandlesByNode(activeLateralEdges),
    [activeLateralEdges],
  );

  return { lateralNodeIds, activeLateralEdges, isolatedLateralIds, lateralHandlesByNode };
};
