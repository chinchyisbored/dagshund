import type { ChangeDesc } from "../types/plan-schema.ts";

/** Build the task key prefix: `tasks[task_key='validate']` */
export const buildTaskKeyPrefix = (taskKey: string): string => `tasks[task_key='${taskKey}']`;

/** Match any key starting with `tasks[task_key='...']` — captures the task key. */
export const TASK_KEY_PATTERN = /^tasks\[task_key='([^']+)'\]/;

/** Match `tasks[task_key='...'].` prefix — for stripping display prefixes. */
export const TASK_KEY_DOT_PREFIX_PATTERN = /^tasks\[task_key='[^']*'\]\./;

/** Collect all change entries whose key starts with the task-key prefix. */
export const collectChangesForTask = (
  taskKey: string,
  changes: Readonly<Record<string, ChangeDesc>> | undefined,
): readonly (readonly [string, ChangeDesc])[] => {
  if (changes === undefined) return [];
  const prefix = buildTaskKeyPrefix(taskKey);
  return Object.entries(changes).filter(([key]) => key.startsWith(prefix));
};
