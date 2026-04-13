import type { Edge } from "@xyflow/react";
import { useMemo } from "react";
import { computeEdgeStyle } from "../utils/edge-styles.ts";

/**
 * Apply visual styling to edges based on interaction state.
 *
 * Priority: hover > filter > lateral isolation > selection.
 * When multiple states are active, the highest-priority one determines edge appearance.
 */
export const useStyledEdges = (
  baseEdges: readonly Edge[],
  hoveredNodeId: string | null,
  selectedNodeId: string | null,
  connectedIds: ReadonlySet<string> | null,
  selectedConnectedIds: ReadonlySet<string> | null,
  filterMatchedIds: ReadonlySet<string> | null,
  isolatedLateralIds: ReadonlySet<string> | null,
): readonly Edge[] =>
  useMemo((): readonly Edge[] => {
    if (
      connectedIds === null &&
      selectedConnectedIds === null &&
      filterMatchedIds === null &&
      isolatedLateralIds === null
    )
      return baseEdges;
    return baseEdges.map((edge) =>
      computeEdgeStyle(
        edge,
        hoveredNodeId,
        selectedNodeId,
        connectedIds,
        selectedConnectedIds,
        filterMatchedIds,
        isolatedLateralIds,
      ),
    );
  }, [
    baseEdges,
    connectedIds,
    selectedConnectedIds,
    filterMatchedIds,
    isolatedLateralIds,
    hoveredNodeId,
    selectedNodeId,
  ]);
