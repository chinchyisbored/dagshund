import { useNodeConnections } from "@xyflow/react";
import { useHoverState } from "./use-hover-context.ts";
import type { DiffState } from "../types/diff-state.ts";
import { getDiffStateStyles, type DiffStateStyles } from "../components/diff-state-styles.ts";

const TARGET_HANDLE = { handleType: "target" } as const;
const SOURCE_HANDLE = { handleType: "source" } as const;

export type NodeDimmingResult = {
  readonly isDimmed: boolean;
  readonly dimOpacity: number;
  readonly isHovered: boolean;
  readonly isSelected: boolean;
  readonly isFilterHighlighted: boolean;
  readonly opacityClass: string;
  readonly styles: DiffStateStyles;
  readonly hasIncoming: boolean;
  readonly hasOutgoing: boolean;
};

/** Shared dimming, filtering, and connection logic for all node components. */
export const useNodeDimming = (id: string, diffState: DiffState): NodeDimmingResult => {
  const { hoveredNodeId, selectedNodeId, connectedIds, selectedConnectedIds, filterMatchedIds } = useHoverState();
  const incomingConnections = useNodeConnections(TARGET_HANDLE);
  const outgoingConnections = useNodeConnections(SOURCE_HANDLE);
  const isDimmedByHover = connectedIds !== null && !connectedIds.has(id);
  const isDimmedByFilter = filterMatchedIds !== null && !filterMatchedIds.has(id);
  const isDimmedBySelection = connectedIds === null && selectedConnectedIds !== null && !selectedConnectedIds.has(id);
  const isDimmed = isDimmedByHover || isDimmedByFilter || isDimmedBySelection;
  const dimOpacity = isDimmedByHover || isDimmedByFilter ? 0.3 : isDimmedBySelection ? 0.5 : 1;
  const isFilterHighlighted = filterMatchedIds !== null && filterMatchedIds.has(id);
  const styles = getDiffStateStyles(diffState);
  const opacityClass = isFilterHighlighted ? "opacity-100" : styles.opacity;

  return {
    isDimmed,
    dimOpacity,
    isHovered: hoveredNodeId === id,
    isSelected: selectedNodeId === id,
    isFilterHighlighted,
    opacityClass,
    styles,
    hasIncoming: incomingConnections.length > 0,
    hasOutgoing: outgoingConnections.length > 0,
  };
};
