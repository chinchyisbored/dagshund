import { z } from "zod/v4";
import type { PlanEntry } from "../types/plan-schema.ts";
import type { PreparationDiagnostic, Projection } from "../types/prepared-plan.ts";
import { selectEffectiveResourceState } from "../utils/effective-resource-state.ts";
import type { NormalizedEntry } from "../utils/normalize-plan.ts";
import { TASK_WAREHOUSE_KEYS } from "../utils/resource-key.ts";
import { buildTaskKeyPrefix, TASK_KEY_PATTERN } from "../utils/task-key.ts";

const dependencySchema = z.object({ task_key: z.string() }).passthrough().readonly();
const taskSchema = z
  .object({ task_key: z.string(), depends_on: z.array(dependencySchema).readonly().optional() })
  .passthrough()
  .readonly();
const tasksSchema = z.array(taskSchema).readonly();
const recordSchema = z.record(z.string(), z.unknown()).readonly();

export type PreparedCluster = {
  readonly rawState: Readonly<Record<string, unknown>>;
  readonly instancePoolId?: string;
  readonly driverInstancePoolId?: string;
};

export type PreparedTask = {
  readonly taskKey: string;
  readonly dependencies: readonly { readonly task_key: string }[];
  readonly rawState: Readonly<Record<string, unknown>>;
  readonly runJob: Projection<string | number>;
  readonly runJobTarget: Projection<string>;
  readonly references: Readonly<Record<string, Projection<string>>>;
  readonly cluster: Projection<PreparedCluster>;
};

export type PreparedJob = {
  readonly jobState: Projection<Readonly<Record<string, unknown>>>;
  readonly currentTasks: Projection<readonly PreparedTask[]>;
  readonly historicalTasks: Projection<readonly PreparedTask[]>;
  readonly deletedTasks: Projection<readonly PreparedTask[]>;
  readonly clusters: Projection<readonly PreparedCluster[]>;
  readonly fileArrivalUrl: Projection<string>;
};

type Result<T> = {
  readonly projection: Projection<T>;
  readonly diagnostic?: PreparationDiagnostic;
};
const diagnostic = (
  resourceKey: string,
  capability: PreparationDiagnostic["capability"],
): PreparationDiagnostic => ({
  resourceKey,
  capability,
  reason: "invalid-shape",
});
const unsupported = <T>(
  resourceKey: string,
  capability: PreparationDiagnostic["capability"],
): Result<T> => {
  const issue = diagnostic(resourceKey, capability);
  return { projection: { status: "unsupported", diagnostic: issue }, diagnostic: issue };
};
const supported = <T>(value: T): Result<T> => ({ projection: { status: "supported", value } });
const absent = <T>(): Projection<T> => ({ status: "absent" });
const projectOptionalString = (resourceKey: string, value: unknown): Projection<string> =>
  value === undefined
    ? absent()
    : typeof value === "string"
      ? { status: "supported", value }
      : { status: "unsupported", diagnostic: diagnostic(resourceKey, "job-tasks") };
const projectReference = (
  resourceKey: string,
  task: Readonly<Record<string, unknown>>,
  parent: string,
  field: string,
): Projection<string> => {
  const value = task[parent];
  if (value === undefined) return absent();
  const parsed = recordSchema.safeParse(value);
  if (!parsed.success)
    return { status: "unsupported", diagnostic: diagnostic(resourceKey, "job-tasks") };
  return projectOptionalString(resourceKey, parsed.data[field]);
};

const projectCluster = (resourceKey: string, value: unknown): Projection<PreparedCluster> => {
  if (value === undefined) return absent();
  const parsed = recordSchema.safeParse(value);
  if (!parsed.success)
    return { status: "unsupported", diagnostic: diagnostic(resourceKey, "job-clusters") };
  const instancePoolId = parsed.data["instance_pool_id"];
  const driverInstancePoolId = parsed.data["driver_instance_pool_id"];
  if (
    (instancePoolId !== undefined && typeof instancePoolId !== "string") ||
    (driverInstancePoolId !== undefined && typeof driverInstancePoolId !== "string")
  )
    return { status: "unsupported", diagnostic: diagnostic(resourceKey, "job-clusters") };
  return {
    status: "supported",
    value: {
      rawState: parsed.data,
      ...(typeof instancePoolId === "string" ? { instancePoolId } : {}),
      ...(typeof driverInstancePoolId === "string" ? { driverInstancePoolId } : {}),
    },
  };
};

const parseTask = (
  resourceKey: string,
  task: z.infer<typeof taskSchema>,
  index: number,
  vars: unknown,
): PreparedTask => {
  const runJobState = task["run_job_task"];
  const runJobRecord = recordSchema.safeParse(runJobState);
  const runJobValue =
    runJobState === undefined
      ? undefined
      : runJobRecord.success
        ? runJobRecord.data["job_id"]
        : null;
  const runJob =
    runJobValue === undefined
      ? absent<string | number>()
      : typeof runJobValue === "string" || typeof runJobValue === "number"
        ? ({ status: "supported", value: runJobValue } as const)
        : ({ status: "unsupported", diagnostic: diagnostic(resourceKey, "job-tasks") } as const);
  const varName = `tasks[${index}].run_job_task.job_id`;
  const varsRecord = recordSchema.safeParse(vars);
  const target = varsRecord.success ? varsRecord.data[varName] : undefined;
  const newCluster = task["new_cluster"];
  return {
    taskKey: task.task_key,
    dependencies: task.depends_on ?? [],
    rawState: task,
    runJob,
    runJobTarget: projectOptionalString(resourceKey, target),
    references: {
      warehouse_id:
        TASK_WAREHOUSE_KEYS.map((parent) =>
          projectReference(resourceKey, task, parent, "warehouse_id"),
        ).find((value) => value.status !== "absent") ?? absent(),
      alert_id: projectReference(resourceKey, task, "alert_task", "alert_id"),
      dashboard_id: projectReference(resourceKey, task, "dashboard_task", "dashboard_id"),
      pipeline_id: projectReference(resourceKey, task, "pipeline_task", "pipeline_id"),
    },
    cluster: projectCluster(resourceKey, newCluster),
  };
};

const parseTasks = (
  resourceKey: string,
  value: unknown,
  capability: PreparationDiagnostic["capability"],
  vars?: unknown,
): Result<readonly PreparedTask[]> => {
  const parsed = tasksSchema.safeParse(value);
  if (!parsed.success) return unsupported(resourceKey, capability);
  return supported(parsed.data.map((task, index) => parseTask(resourceKey, task, index, vars)));
};

const projectFileArrivalUrl = (resourceKey: string, snapshot: unknown): Projection<string> => {
  if (snapshot === undefined) return absent<string>();
  const state = recordSchema.safeParse(snapshot);
  if (!state.success) return unsupported<string>(resourceKey, "job-file-arrival").projection;
  if (!("trigger" in state.data)) return absent<string>();
  const trigger = recordSchema.safeParse(state.data["trigger"]);
  if (!trigger.success) return unsupported<string>(resourceKey, "job-file-arrival").projection;
  if (!("file_arrival" in trigger.data)) return absent<string>();
  const fileArrival = recordSchema.safeParse(trigger.data["file_arrival"]);
  if (!fileArrival.success) return unsupported<string>(resourceKey, "job-file-arrival").projection;
  const url = fileArrival.data["url"];
  if (url === undefined) return absent<string>();
  return typeof url === "string"
    ? { status: "supported", value: url }
    : unsupported<string>(resourceKey, "job-file-arrival").projection;
};

const currentTaskSnapshot = (entry: PlanEntry): unknown => {
  const state = entry.new_state;
  return state !== null &&
    typeof state === "object" &&
    "value" in state &&
    state.value !== null &&
    typeof state.value === "object"
    ? "tasks" in state.value
      ? state.value.tasks
      : undefined
    : undefined;
};
const remoteTaskSnapshot = (entry: PlanEntry): unknown => {
  const state = entry.remote_state;
  return state !== null && typeof state === "object"
    ? "tasks" in state
      ? state.tasks
      : undefined
    : undefined;
};
const currentVars = (entry: PlanEntry): unknown => {
  const state = entry.new_state;
  return state !== null && typeof state === "object" && "vars" in state ? state.vars : undefined;
};
const clusterProjection = (
  resourceKey: string,
  jobState: Projection<Readonly<Record<string, unknown>>>,
  tasks: Projection<readonly PreparedTask[]>,
): Result<readonly PreparedCluster[]> => {
  const stateClusters =
    jobState.status === "supported" ? jobState.value["job_clusters"] : undefined;
  const stateResult =
    stateClusters === undefined ? undefined : z.array(recordSchema).safeParse(stateClusters);
  if (stateResult !== undefined && !stateResult.success)
    return unsupported(resourceKey, "job-clusters");
  const stateClusterValues: PreparedCluster[] = [];
  for (const item of stateResult?.success ? stateResult.data : []) {
    const parsed = projectCluster(resourceKey, item["new_cluster"]);
    if (parsed.status !== "supported") return unsupported(resourceKey, "job-clusters");
    stateClusterValues.push(parsed.value);
  }
  const taskClusterValues: PreparedCluster[] = [];
  for (const task of tasks.status === "supported" ? tasks.value : []) {
    if (task.cluster.status === "unsupported") return unsupported(resourceKey, "job-clusters");
    if (task.cluster.status === "supported") taskClusterValues.push(task.cluster.value);
    const nested = task.rawState["for_each_task"];
    if (nested === undefined) continue;
    const nestedRecord = recordSchema.safeParse(nested);
    if (!nestedRecord.success) return unsupported(resourceKey, "job-clusters");
    const nestedTask = nestedRecord.data["task"];
    if (nestedTask === undefined) continue;
    const nestedTaskRecord = recordSchema.safeParse(nestedTask);
    if (!nestedTaskRecord.success) return unsupported(resourceKey, "job-clusters");
    const nestedCluster = nestedTaskRecord.data["new_cluster"];
    if (nestedCluster === undefined) continue;
    const parsed = projectCluster(resourceKey, nestedCluster);
    if (parsed.status !== "supported") return unsupported(resourceKey, "job-clusters");
    taskClusterValues.push(parsed.value);
  }
  return supported([...stateClusterValues, ...taskClusterValues]);
};

const taskDiagnostics = (
  tasks: Projection<readonly PreparedTask[]>,
): readonly PreparationDiagnostic[] => {
  if (tasks.status !== "supported") return [];
  return tasks.value.flatMap((task) =>
    [task.runJob, task.runJobTarget, ...Object.values(task.references), task.cluster].flatMap(
      (slice) => (slice.status === "unsupported" ? [slice.diagnostic] : []),
    ),
  );
};

/** Prepare distinct current, historical, deleted and cluster source slices for a job. */
export const prepareJob = (
  resourceKey: string,
  entry: NormalizedEntry,
): { readonly job: PreparedJob; readonly diagnostics: readonly PreparationDiagnostic[] } => {
  const diagnostics: PreparationDiagnostic[] = [];
  const selected = selectEffectiveResourceState(entry);
  const currentState =
    selected.origin === "absent"
      ? undefined
      : selected.origin === "new"
        ? currentTaskSnapshot(entry)
        : selected.snapshot !== null &&
            typeof selected.snapshot === "object" &&
            "tasks" in selected.snapshot
          ? selected.snapshot.tasks
          : undefined;
  const current =
    currentState === undefined
      ? { projection: absent<readonly PreparedTask[]>() }
      : parseTasks(
          resourceKey,
          currentState,
          "job-tasks",
          selected.origin === "new" ? currentVars(entry) : undefined,
        );
  const historicalState = remoteTaskSnapshot(entry);
  const historical =
    historicalState === undefined
      ? { projection: absent<readonly PreparedTask[]>() }
      : selected.origin === "remote" && currentState === historicalState
        ? current
        : parseTasks(resourceKey, historicalState, "job-tasks");
  const deletedRaw: unknown[] = [];
  for (const [key, change] of Object.entries(entry.changes ?? {})) {
    const match = TASK_KEY_PATTERN.exec(key);
    if (
      match?.[1] === undefined ||
      key !== buildTaskKeyPrefix(match[1]) ||
      change.old === undefined ||
      change.new !== undefined
    )
      continue;
    deletedRaw.push(change.old);
  }
  const deleted =
    deletedRaw.length === 0
      ? { projection: { status: "supported", value: [] } as const }
      : parseTasks(resourceKey, deletedRaw, "job-tasks");
  const stateRecord =
    selected.origin === "new"
      ? entry.new_state !== null &&
        typeof entry.new_state === "object" &&
        "value" in entry.new_state
        ? entry.new_state.value
        : undefined
      : selected.origin === "remote"
        ? selected.snapshot
        : undefined;
  const parsedState = recordSchema.safeParse(stateRecord);
  const jobStateValue = parsedState.success
    ? Object.fromEntries(Object.entries(parsedState.data).filter(([key]) => key !== "tasks"))
    : undefined;
  const jobState =
    jobStateValue !== undefined && Object.keys(jobStateValue).length > 0
      ? ({ status: "supported", value: jobStateValue } as const)
      : absent<Readonly<Record<string, unknown>>>();
  const clusters = clusterProjection(resourceKey, jobState, current.projection);
  const fileArrivalUrl = projectFileArrivalUrl(
    resourceKey,
    selected.origin === "absent" ? undefined : selected.snapshot,
  );
  if (fileArrivalUrl.status === "unsupported") diagnostics.push(fileArrivalUrl.diagnostic);
  for (const result of [current, historical, deleted, clusters])
    if (result.diagnostic) diagnostics.push(result.diagnostic);
  diagnostics.push(...taskDiagnostics(current.projection));
  diagnostics.push(...taskDiagnostics(historical.projection));
  diagnostics.push(...taskDiagnostics(deleted.projection));
  const uniqueDiagnostics = [
    ...new Map(
      diagnostics.map((item) => [`${item.resourceKey}:${item.capability}`, item]),
    ).values(),
  ];
  return {
    job: {
      jobState,
      currentTasks: current.projection,
      historicalTasks: historical.projection,
      deletedTasks: deleted.projection,
      clusters: clusters.projection,
      fileArrivalUrl,
    },
    diagnostics: uniqueDiagnostics,
  };
};
