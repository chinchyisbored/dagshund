import type { PlanEntry } from "../types/plan-schema.ts";
import { getUnknownProp, isUnknownRecord } from "../utils/unknown-record.ts";

/** Extract a resource key from a Databricks bundle interpolation like "${resources.jobs.X.id}". */
const INTERPOLATION_PATTERN = /^\$\{(resources\..+?)\.id\}$/;

const parseResourceReference = (interpolation: string): string | undefined =>
  INTERPOLATION_PATTERN.exec(interpolation)?.[1];

/** Build a map from numeric remote_state.job_id to resource key for cross-job resolution. */
export const buildJobIdMap = (
  entries: readonly (readonly [string, PlanEntry])[],
): ReadonlyMap<number, string> => {
  const map = new Map<number, string>();
  for (const [resourceKey, entry] of entries) {
    const remoteState = entry.remote_state;
    if (typeof remoteState === "object" && remoteState !== null && "job_id" in remoteState) {
      const { job_id: jobId } = remoteState;
      if (typeof jobId === "number" && jobId !== 0) {
        map.set(jobId, resourceKey);
      }
    }
  }
  return map;
};

/** Resolve a run_job_task target via new_state.vars interpolation references.
 *  Handles placeholder job_id=0 for newly created target jobs. */
const resolveRunJobTargetFromVars = (newState: unknown, taskKey: string): string | undefined => {
  const vars = getUnknownProp(newState, "vars");
  if (!isUnknownRecord(vars)) return undefined;
  const value = getUnknownProp(newState, "value");
  if (!isUnknownRecord(value)) return undefined;
  const tasks = value["tasks"];
  if (!Array.isArray(tasks)) return undefined;
  const taskIndex = tasks.findIndex((t) => isUnknownRecord(t) && t["task_key"] === taskKey);
  if (taskIndex < 0) return undefined;
  const interpolation = vars[`tasks[${taskIndex}].run_job_task.job_id`];
  return typeof interpolation === "string" ? parseResourceReference(interpolation) : undefined;
};

/** Resolve a run_job_task's job_id to the target resource key. */
export const resolveRunJobTarget = (
  jobId: string | number,
  jobIdMap: ReadonlyMap<number, string>,
  newState: unknown,
  taskKey: string,
): string | undefined =>
  typeof jobId === "string"
    ? parseResourceReference(jobId)
    : (jobIdMap.get(jobId) ?? resolveRunJobTargetFromVars(newState, taskKey));
