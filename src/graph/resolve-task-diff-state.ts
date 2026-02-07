import { mapActionToDiffState } from "../parser/map-diff-state.ts";
import type { DiffState } from "../types/diff-state.ts";
import type { ActionType, ChangeDesc } from "../types/plan-schema.ts";
import { buildTaskKeyPrefix, collectChangesForTask } from "../utils/task-key.ts";

/** Determine if a whole-task change represents an addition (new only, no old). */
const isTaskAdded = (change: ChangeDesc): boolean =>
  change.new !== undefined && change.old === undefined;

/** Determine if a whole-task change represents a removal (old only, no new). */
const isTaskRemoved = (change: ChangeDesc): boolean =>
  change.old !== undefined && change.new === undefined;

/**
 * Resolve the DiffState for a single task within a resource.
 *
 * When the resource-level action is "create", all tasks are added.
 * When the resource-level action is "delete", all tasks are removed.
 * Otherwise, inspects the changes record for task-specific entries.
 */
export const resolveTaskDiffState = (
  taskKey: string,
  resourceAction: ActionType | undefined,
  changes: Readonly<Record<string, ChangeDesc>> | undefined,
): DiffState => {
  const resourceDiff = mapActionToDiffState(resourceAction);
  if (resourceDiff === "added" || resourceDiff === "removed") {
    return resourceDiff;
  }

  const taskChanges = collectChangesForTask(taskKey, changes);
  if (taskChanges.length === 0) {
    return "unchanged";
  }

  const exactKey = buildTaskKeyPrefix(taskKey);
  const wholeTaskChange = taskChanges.find(([key]) => key === exactKey);
  if (wholeTaskChange !== undefined) {
    const change = wholeTaskChange[1];
    if (isTaskAdded(change)) return "added";
    if (isTaskRemoved(change)) return "removed";
    return "modified";
  }

  const hasNonSkipChange = taskChanges.some(
    ([, change]) => change.action !== "skip" && change.action !== "",
  );
  return hasNonSkipChange ? "modified" : "unchanged";
};
