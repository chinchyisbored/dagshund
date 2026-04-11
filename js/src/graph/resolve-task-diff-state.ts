import { mapActionToDiffState } from "../parser/map-diff-state.ts";
import type { DiffState } from "../types/diff-state.ts";
import type { ActionType, ChangeDesc } from "../types/plan-schema.ts";
import { isTopologyDriftChange } from "../utils/structural-diff.ts";
import { buildTaskKeyPrefix, collectChangesForTask } from "../utils/task-key.ts";

/**
 * Classify a change entry as added, removed, or modified based on old/new fields.
 *
 * Topology drift (old == new, no `remote` field) means the entity is defined in
 * the bundle but missing from the remote — Databricks will create it on apply.
 * From the remote's perspective that is an addition, so it classifies as "added"
 * even though both `old` and `new` are populated.
 */
export const classifyChange = (
  change: ChangeDesc,
): "added" | "removed" | "modified" | undefined => {
  if (isTopologyDriftChange(change)) return "added";
  const hasNew = change.new !== undefined;
  const hasOld = change.old !== undefined;
  if (hasNew && !hasOld) return "added";
  if (hasOld && !hasNew) return "removed";
  if (hasNew && hasOld) return "modified";
  return undefined;
};

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
    const classification = classifyChange(wholeTaskChange[1]);
    if (classification === "added" || classification === "removed") return classification;
    return "modified";
  }

  const hasNonSkipChange = taskChanges.some(
    ([, change]) => change.action !== "skip" && change.action !== "",
  );
  return hasNonSkipChange ? "modified" : "unchanged";
};
