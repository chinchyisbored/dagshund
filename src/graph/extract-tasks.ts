import { z } from "zod/v4";

const taskEntrySchema = z
  .object({
    task_key: z.string(),
    depends_on: z
      .array(z.object({ task_key: z.string() }).readonly())
      .readonly()
      .optional(),
    run_job_task: z.object({ job_id: z.string() }).passthrough().readonly().optional(),
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

export type TaskEntry = z.infer<typeof taskEntrySchema>;

/** Safely extract task entries from a PlanEntry's untyped new_state. */
export const extractTaskEntries = (newState: unknown): readonly TaskEntry[] => {
  const parsed = newStateSchema.safeParse(newState);
  if (!parsed.success) {
    return [];
  }
  return parsed.data.value?.tasks ?? [];
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

/** Extract task-level state as a plain record from a TaskEntry. */
export const extractTaskState = (task: TaskEntry): Readonly<Record<string, unknown>> =>
  task as unknown as Record<string, unknown>;
