import type { Node } from "@xyflow/react";
import type { DiffState } from "../types/diff-state.ts";
import type { DagNodeData } from "../types/graph-types.ts";

/** React Flow types node.data as Record<string, unknown>; our nodes carry DagNodeData.
 *  The cast is unavoidable because React Flow's generic param doesn't propagate to event handlers. */
export const getNodeData = (node: Node): DagNodeData => node.data as DagNodeData;

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
