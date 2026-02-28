import { z } from "zod/v4";
import { buildTaskKeyPrefix, TASK_KEY_PATTERN } from "../utils/task-key.ts";

const taskEntrySchema = z
  .object({
    task_key: z.string(),
    depends_on: z
      .array(z.object({ task_key: z.string() }).readonly())
      .readonly()
      .optional(),
    run_job_task: z
      .object({ job_id: z.union([z.string(), z.number()]) })
      .passthrough()
      .readonly()
      .optional(),
  })
  .passthrough()
  .readonly();

const newStateValueSchema = z
  .object({
    tasks: z.array(taskEntrySchema).readonly().optional(),
  })
  .passthrough()
  .readonly();

const newStateSchema = z
  .object({
    value: newStateValueSchema.optional(),
  })
  .readonly();

const remoteStateTasksSchema = z
  .object({
    tasks: z.array(taskEntrySchema).readonly().optional(),
  })
  .passthrough()
  .readonly();

export type TaskEntry = z.infer<typeof taskEntrySchema>;

/** Safely extract task entries from a PlanEntry's untyped new_state. */
export const extractTaskEntries = (newState: unknown): readonly TaskEntry[] => {
  const parsed = newStateSchema.safeParse(newState);
  if (!parsed.success) {
    return [];
  }
  return parsed.data.value?.tasks ?? [];
};

/** Extract task entries from a PlanEntry's remote_state (flat shape, no value wrapper). */
export const extractTaskEntriesFromRemoteState = (remoteState: unknown): readonly TaskEntry[] => {
  const parsed = remoteStateTasksSchema.safeParse(remoteState);
  if (!parsed.success) return [];
  return parsed.data.tasks ?? [];
};

/** Extract task entries, preferring new_state and falling back to remote_state for skip resources.
 *  The remote_state fallback is intentional: Databricks "skip" resources have an empty new_state.tasks
 *  but retain the prior task list in remote_state. */
export const resolveTaskEntries = (
  newState: unknown,
  remoteState: unknown,
): readonly TaskEntry[] => {
  const fromNewState = extractTaskEntries(newState);
  if (fromNewState.length > 0) return fromNewState;
  return extractTaskEntriesFromRemoteState(remoteState);
};

/** Extract job-level state (all fields except `tasks`) from new_state. */
export const extractJobState = (
  newState: unknown,
): Readonly<Record<string, unknown>> | undefined => {
  const parsed = newStateSchema.safeParse(newState);
  if (!parsed.success) return undefined;
  const value = parsed.data.value;
  if (value === undefined) return undefined;
  const { tasks: _, ...rest } = value;
  return Object.keys(rest).length > 0 ? rest : undefined;
};

/** Extract job-level state (all fields except `tasks`) from remote_state. */
export const extractJobStateFromRemoteState = (
  remoteState: unknown,
): Readonly<Record<string, unknown>> | undefined => {
  const parsed = remoteStateTasksSchema.safeParse(remoteState);
  if (!parsed.success) return undefined;
  const { tasks: _, ...rest } = parsed.data;
  return Object.keys(rest).length > 0 ? rest : undefined;
};

/** Resolve job-level state, preferring new_state and falling back to remote_state. */
export const resolveJobState = (
  newState: unknown,
  remoteState: unknown,
): Readonly<Record<string, unknown>> | undefined =>
  extractJobState(newState) ?? extractJobStateFromRemoteState(remoteState);

/** Extract task-level state as a plain record from a TaskEntry. */
export const extractTaskState = (task: TaskEntry): Readonly<Record<string, unknown>> =>
  Object.fromEntries(Object.entries(task));

/** Extract deleted task entries from a changes record.
 *  Deleted tasks have a whole-task change with old defined and new undefined. */
export const extractDeletedTaskEntries = (
  changes: Readonly<Record<string, unknown>> | undefined,
): readonly TaskEntry[] => {
  if (changes === undefined) return [];

  const deletedTasks: TaskEntry[] = [];
  for (const [key, change] of Object.entries(changes)) {
    const match = TASK_KEY_PATTERN.exec(key);
    if (match?.[1] === undefined || key !== buildTaskKeyPrefix(match[1])) continue;

    if (typeof change !== "object" || change === null) continue;
    const old = "old" in change ? change.old : undefined;
    const hasNew = "new" in change && change.new !== undefined;
    if (old === undefined || hasNew) continue;

    const parsed = taskEntrySchema.safeParse(old);
    if (parsed.success) {
      deletedTasks.push(parsed.data);
    }
  }

  return deletedTasks;
};

/** Resolve all task entries (live + deleted) for a plan entry. */
export const resolveAllTaskEntries = (
  newState: unknown,
  remoteState: unknown,
  changes: Readonly<Record<string, unknown>> | undefined,
): readonly TaskEntry[] => {
  const live = resolveTaskEntries(newState, remoteState);
  const deleted = extractDeletedTaskEntries(changes);
  return [...live, ...deleted];
};
