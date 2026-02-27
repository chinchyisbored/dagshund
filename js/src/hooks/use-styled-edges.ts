import type { Edge } from "@xyflow/react";
import { useMemo } from "react";

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
  lateralIsolatedIds: ReadonlySet<string> | null,
): readonly Edge[] =>
  useMemo((): readonly Edge[] => {
    // React Flow requires mutable Edge[]; the `as` cast sheds the readonly modifier.
    if (
      connectedIds === null &&
      selectedConnectedIds === null &&
      filterMatchedIds === null &&
      lateralIsolatedIds === null
    )
      return baseEdges as Edge[];
    return baseEdges.map((edge) => {
      const baseStyle = edge.style ?? {};
      // Hover takes priority — highlight direct connections, dim the rest.
      if (connectedIds !== null) {
        const isDirectlyConnected = edge.source === hoveredNodeId || edge.target === hoveredNodeId;
        const isBetweenConnected = connectedIds.has(edge.source) && connectedIds.has(edge.target);
        return isDirectlyConnected
          ? { ...edge, style: { ...baseStyle, strokeWidth: 2.5, filter: "brightness(1.5)" } }
          : isBetweenConnected
            ? { ...edge, style: baseStyle }
            : { ...edge, style: { ...baseStyle, strokeWidth: 2, opacity: 0.15 } };
      }
      // Filter — show edges touching matched nodes, dim the rest.
      if (filterMatchedIds !== null) {
        const isRelevant = filterMatchedIds.has(edge.source) || filterMatchedIds.has(edge.target);
        return isRelevant
          ? { ...edge, style: baseStyle }
          : { ...edge, style: { ...baseStyle, opacity: 0.15 } };
      }
      // Lateral isolation — edges touching isolated node stay visible, others dim.
      if (lateralIsolatedIds !== null) {
        const touchesIsolated =
          lateralIsolatedIds.has(edge.source) && lateralIsolatedIds.has(edge.target);
        return touchesIsolated
          ? { ...edge, style: baseStyle }
          : { ...edge, style: { ...baseStyle, opacity: 0.15 } };
      }
      // Selection — subtler than hover, slightly higher dim opacity.
      if (selectedConnectedIds !== null) {
        const isDirectlyConnected =
          edge.source === selectedNodeId || edge.target === selectedNodeId;
        const isBetweenConnected =
          selectedConnectedIds.has(edge.source) && selectedConnectedIds.has(edge.target);
        return isDirectlyConnected
          ? { ...edge, style: { ...baseStyle, strokeWidth: 2.5 } }
          : isBetweenConnected
            ? { ...edge, style: baseStyle }
            : { ...edge, style: { ...baseStyle, opacity: 0.3 } };
      }
      return { ...edge, style: baseStyle };
    });
  }, [
    baseEdges,
    connectedIds,
    selectedConnectedIds,
    filterMatchedIds,
    lateralIsolatedIds,
    hoveredNodeId,
    selectedNodeId,
  ]);
