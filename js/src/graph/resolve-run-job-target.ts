import type { PreparedTask } from "../preparation/prepare-job.ts";
import type { PlanEntry } from "../types/plan-schema.ts";
import type { PreparedPlan } from "../types/prepared-plan.ts";
import { buildTaskNodeId } from "../utils/resource-key.ts";

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
    if (resourceKey.split(".")[1] !== "jobs") continue;
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

/** Resolve a run_job_task's job_id to the target resource key. */
export const resolvePreparedRunJobTarget = (
  task: PreparedTask,
  jobIdMap: ReadonlyMap<number, string>,
): string | undefined => {
  if (task.runJob.status !== "supported") return undefined;
  const jobId = task.runJob.value;
  if (typeof jobId === "string") return parseResourceReference(jobId);
  return (
    jobIdMap.get(jobId) ??
    (task.runJobTarget.status === "supported"
      ? parseResourceReference(task.runJobTarget.value)
      : undefined)
  );
};

export type FinalRunJobTarget =
  | { readonly kind: "managed"; readonly resourceKey: string }
  | { readonly kind: "external"; readonly jobId: number }
  | { readonly kind: "unsupported" };

/** Apply shared plan-membership and numeric-phantom policy to one prepared task. */
export const resolveFinalRunJobTarget = (
  task: PreparedTask,
  jobIdMap: ReadonlyMap<number, string>,
  jobResourceKeys: ReadonlySet<string>,
): FinalRunJobTarget => {
  if (task.runJob.status !== "supported") return { kind: "unsupported" };
  const candidate = resolvePreparedRunJobTarget(task, jobIdMap);
  if (candidate !== undefined && jobResourceKeys.has(candidate))
    return { kind: "managed", resourceKey: candidate };
  const jobId = task.runJob.value;
  return typeof jobId === "number" && jobId !== 0
    ? { kind: "external", jobId }
    : { kind: "unsupported" };
};

/** Resolve every current and deleted run-job occurrence for both graph views. */
export const buildFinalRunJobTargets = (
  entries: readonly (readonly [string, PlanEntry])[],
  plan: PreparedPlan,
  jobIdMap: ReadonlyMap<number, string>,
): ReadonlyMap<string, FinalRunJobTarget> => {
  const jobResourceKeys = new Set(entries.map(([resourceKey]) => resourceKey));
  const targets = new Map<string, FinalRunJobTarget>();
  for (const [resourceKey] of entries) {
    const projection = plan.byResourceKey.get(resourceKey)?.job;
    const job = projection?.status === "supported" ? projection.value : undefined;
    const tasks = [
      ...(job?.currentTasks.status === "supported" ? job.currentTasks.value : []),
      ...(job?.deletedTasks.status === "supported" ? job.deletedTasks.value : []),
    ];
    for (const task of tasks) {
      targets.set(
        buildTaskNodeId(resourceKey, task.taskKey),
        resolveFinalRunJobTarget(task, jobIdMap, jobResourceKeys),
      );
    }
  }
  return targets;
};
