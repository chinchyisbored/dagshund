import { useNodeConnections } from "@xyflow/react";
import type { CSSProperties } from "react";
import type { DiffState } from "../types/diff-state.ts";
import { type DiffStateStyles, getDiffStateStyles } from "../utils/diff-state-styles.ts";
import { buildGlowStyle } from "../utils/node-dimming.ts";
import { useInteractionState } from "./use-interaction-context.ts";

const TARGET_HANDLE = { handleType: "target" } as const;
const SOURCE_HANDLE = { handleType: "source" } as const;

type NodeDimmingResult = {
  readonly opacityClass: string;
  readonly glowStyle: CSSProperties;
  readonly styles: DiffStateStyles;
  readonly hasIncoming: boolean;
  readonly hasOutgoing: boolean;
  readonly lateralHandles: ReadonlySet<string> | undefined;
  readonly hasLateralEdges: boolean;
  readonly isLateralIsolated: boolean;
};

/** Shared dimming, filtering, and connection logic for all node components. */
export const useNodeDimming = (id: string, diffState: DiffState): NodeDimmingResult => {
  const {
    hoveredNodeId,
    selectedNodeId,
    connectedIds,
    selectedConnectedIds,
    filterMatchedIds,
    lateralHandlesByNode,
    isolatedLateralIds,
    lateralNodeIds,
    isolatedLateralNodeId,
    showLateralEdges,
  } = useInteractionState();
  const incomingConnections = useNodeConnections(TARGET_HANDLE);
  const outgoingConnections = useNodeConnections(SOURCE_HANDLE);
  const isDimmedByHover = connectedIds !== null && !connectedIds.has(id);
  const isDimmedByFilter = filterMatchedIds !== null && !filterMatchedIds.has(id);
  const isDimmedBySelection =
    connectedIds === null && selectedConnectedIds !== null && !selectedConnectedIds.has(id);
  const isDimmedByLateralIsolation = isolatedLateralIds !== null && !isolatedLateralIds.has(id);
  const isDimmedByLateralToggle =
    showLateralEdges &&
    isolatedLateralIds === null &&
    lateralNodeIds !== null &&
    !lateralNodeIds.has(id);
  const isDimmed =
    isDimmedByHover ||
    isDimmedByFilter ||
    isDimmedBySelection ||
    isDimmedByLateralIsolation ||
    isDimmedByLateralToggle;
  const dimOpacity =
    isDimmedByHover || isDimmedByFilter
      ? 0.3
      : isDimmedBySelection
        ? 0.5
        : isDimmedByLateralIsolation || isDimmedByLateralToggle
          ? 0.3
          : 1;
  // biome-ignore lint/complexity/useOptionalChain: optional chain returns boolean | undefined, need boolean
  const isFilterHighlighted = filterMatchedIds !== null && filterMatchedIds.has(id);
  const styles = getDiffStateStyles(diffState);
  const opacityClass = isFilterHighlighted ? "opacity-100" : styles.opacity;

  const isHovered = hoveredNodeId === id;
  const isSelected = selectedNodeId === id;
  const glowStyle = buildGlowStyle(isSelected, isHovered, isDimmed, dimOpacity, styles.hoverGlow);

  return {
    opacityClass,
    glowStyle,
    styles,
    hasIncoming: incomingConnections.some((c) => !c.targetHandle?.startsWith("lateral-")),
    hasOutgoing: outgoingConnections.some((c) => !c.sourceHandle?.startsWith("lateral-")),
    lateralHandles: lateralHandlesByNode?.get(id),
    // biome-ignore lint/complexity/useOptionalChain: optional chain returns boolean | undefined, need boolean
    hasLateralEdges: lateralNodeIds !== null && lateralNodeIds.has(id),
    isLateralIsolated: isolatedLateralNodeId === id,
  };
};
