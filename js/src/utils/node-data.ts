import type { Node } from "@xyflow/react";
import { extractDerivedNodeBadge } from "../graph/derived-node-specs.ts";
import type { DiffState } from "../types/diff-state.ts";
import type { DagNodeData } from "../types/graph-types.ts";
import { extractPhantomBadge, extractTypeBadge } from "./resource-key.ts";

/** React Flow types node.data as Record<string, unknown>; our nodes carry DagNodeData.
 *  The cast is unavoidable because React Flow's generic param doesn't propagate to event handlers. */
export const getNodeData = (node: Node): DagNodeData => node.data as DagNodeData;

export const extractNodeBadge = (data: DagNodeData): string | undefined => {
  if (data.nodeKind === "derived") return extractDerivedNodeBadge(data.derivedKind);
  if (data.nodeKind === "phantom") return extractPhantomBadge(data.resourceKey);
  return extractTypeBadge(data.resourceKey);
};

/** Diff state as displayed under the wheel-suppression toggle: tasks whose only
 *  changes are wheel-version bumps render as unchanged while suppression is on
 *  (dagshund-aqcx). Single source for node styling, filter counts, and dimming. */
export const resolveDisplayedDiffState = (
  data: DagNodeData,
  hideWheelUpdates: boolean,
): DiffState =>
  hideWheelUpdates && data.nodeKind === "task" && data.isWheelOnlyChange
    ? "unchanged"
    : data.diffState;
