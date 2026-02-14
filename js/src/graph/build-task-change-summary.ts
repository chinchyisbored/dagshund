import type { DiffState } from "../types/diff-state.ts";
import type { TaskChangeSummary } from "../types/graph-types.ts";
import type { ActionType, ChangeDesc } from "../types/plan-schema.ts";
import { TASK_KEY_PATTERN } from "../utils/task-key.ts";
import type { TaskEntry } from "./extract-tasks.ts";
import { resolveTaskDiffState } from "./resolve-task-diff-state.ts";

/** Extract all unique task keys referenced in the changes record. */
const extractTaskKeysFromChanges = (
  changes: Readonly<Record<string, ChangeDesc>> | undefined,
): ReadonlySet<string> => {
  if (changes === undefined) return new Set();
  const keys = new Set<string>();
  for (const key of Object.keys(changes)) {
    const match = TASK_KEY_PATTERN.exec(key);
    if (match?.[1] !== undefined) {
      keys.add(match[1]);
    }
  }
  return keys;
};

/** Collect all task keys from both new_state tasks and changes (covers removed tasks). */
const collectAllTaskKeys = (
  tasks: readonly TaskEntry[],
  changes: Readonly<Record<string, ChangeDesc>> | undefined,
): ReadonlySet<string> => {
  const fromTasks = new Set(tasks.map((t) => t.task_key));
  const fromChanges = extractTaskKeysFromChanges(changes);
  return new Set([...fromTasks, ...fromChanges]);
};

/** Sort order for diff states: added first, then removed, then modified. */
const DIFF_STATE_ORDER: Readonly<Record<DiffState, number>> = {
  added: 0,
  removed: 1,
  modified: 2,
  unchanged: 3,
};

/**
 * Build a summary of task-level changes for a job node.
 *
 * Returns undefined when:
 * - The resource is added or removed (all tasks inherit the job state — redundant)
 * - No tasks have a non-unchanged diff state
 */
export const buildTaskChangeSummary = (
  tasks: readonly TaskEntry[],
  resourceAction: ActionType | undefined,
  changes: Readonly<Record<string, ChangeDesc>> | undefined,
): TaskChangeSummary | undefined => {
  const resourceDiff =
    resourceAction === "create" ? "added" : resourceAction === "delete" ? "removed" : undefined;
  if (resourceDiff === "added" || resourceDiff === "removed") return undefined;

  const allKeys = collectAllTaskKeys(tasks, changes);
  if (allKeys.size === 0) return undefined;

  const entries = [...allKeys].map((taskKey) => ({
    taskKey,
    diffState: resolveTaskDiffState(taskKey, resourceAction, changes),
  }));

  const changedEntries = entries.filter((entry) => entry.diffState !== "unchanged");
  if (changedEntries.length === 0) return undefined;

  return changedEntries.toSorted(
    (a, b) =>
      DIFF_STATE_ORDER[a.diffState] - DIFF_STATE_ORDER[b.diffState] ||
      a.taskKey.localeCompare(b.taskKey),
  );
};
