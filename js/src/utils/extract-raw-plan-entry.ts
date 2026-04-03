import type { DagNodeData } from "../types/graph-types.ts";
import type { Plan, PlanEntry } from "../types/plan-schema.ts";
import { buildTaskKeyPrefix, collectChangesForTask } from "./task-key.ts";

export type RawTaskSlice = {
  readonly label: string;
  readonly data: unknown;
};

export type RawPlanSlice =
  | { readonly kind: "entry"; readonly data: unknown }
  | { readonly kind: "entry-with-subs"; readonly entries: ReadonlyMap<string, unknown> }
  | { readonly kind: "task-slices"; readonly slices: readonly RawTaskSlice[] };

/** Find a task object by task_key in a raw tasks array, returning the object and its index. */
const findRawTask = (
  tasks: unknown,
  taskKey: string,
): { readonly index: number; readonly task: unknown } | undefined => {
  if (!Array.isArray(tasks)) return undefined;
  const index = tasks.findIndex(
    (t) => typeof t === "object" && t !== null && "task_key" in t && t.task_key === taskKey,
  );
  if (index === -1) return undefined;
  return { index, task: tasks[index] };
};

/** Extract a raw task from new_state.value.tasks[] by task_key match. */
const findTaskInNewState = (newState: unknown, taskKey: string): RawTaskSlice | undefined => {
  if (typeof newState !== "object" || newState === null || !("value" in newState)) return undefined;
  // narrowed by typeof+null+"value" guard above — new_state is an untyped JSON wrapper
  const value = (newState as Record<string, unknown>)["value"];
  if (typeof value !== "object" || value === null || !("tasks" in value)) return undefined;
  // narrowed by typeof+null+"tasks" guard above — value is an untyped JSON object
  const match = findRawTask((value as Record<string, unknown>)["tasks"], taskKey);
  return match !== undefined
    ? { label: `new_state.value.tasks[${match.index}]`, data: match.task }
    : undefined;
};

/** Extract a raw task from remote_state.tasks[] by task_key match. */
const findTaskInRemoteState = (remoteState: unknown, taskKey: string): RawTaskSlice | undefined => {
  if (typeof remoteState !== "object" || remoteState === null || !("tasks" in remoteState))
    return undefined;
  // narrowed by typeof+null+"tasks" guard above — remote_state is an untyped JSON object
  const match = findRawTask((remoteState as Record<string, unknown>)["tasks"], taskKey);
  return match !== undefined
    ? { label: `remote_state.tasks[${match.index}]`, data: match.task }
    : undefined;
};

/** Extract labeled slices of raw plan JSON for a single task within a job PlanEntry. */
const extractRawTaskSlices = (entry: PlanEntry, taskKey: string): readonly RawTaskSlice[] => {
  const slices: RawTaskSlice[] = [];

  const fromNewState = findTaskInNewState(entry.new_state, taskKey);
  if (fromNewState !== undefined) slices.push(fromNewState);

  const fromRemoteState = findTaskInRemoteState(entry.remote_state, taskKey);
  if (fromRemoteState !== undefined) slices.push(fromRemoteState);

  const taskChanges = collectChangesForTask(taskKey, entry.changes);
  if (taskChanges.length > 0) {
    slices.push({
      label: `changes (filtered to ${buildTaskKeyPrefix(taskKey)})`,
      data: Object.fromEntries(taskChanges),
    });
  }

  return slices;
};

/** Collect sub-resource entries for a resource key (e.g. permissions, grants). */
const collectSubResourceEntries = (
  planEntries: Readonly<Record<string, PlanEntry>>,
  resourceKey: string,
): ReadonlyMap<string, unknown> | undefined => {
  const prefix = `${resourceKey}.`;
  const entries = new Map<string, unknown>();
  entries.set(resourceKey, planEntries[resourceKey]);
  for (const key of Object.keys(planEntries)) {
    if (key.startsWith(prefix)) {
      entries.set(key, planEntries[key]);
    }
  }
  return entries.size > 1 ? entries : undefined;
};

/** Extract the original (pre-merge) plan JSON for a given node.
 *  Returns a discriminated slice describing what to render, or undefined for root/phantom nodes. */
export const extractRawPlanSlice = (plan: Plan, data: DagNodeData): RawPlanSlice | undefined => {
  const planEntries = plan.plan;
  if (planEntries === undefined) return undefined;

  if (data.nodeKind === "root" || data.nodeKind === "phantom") return undefined;

  const entry = planEntries[data.resourceKey];
  if (entry === undefined) return undefined;

  if (data.nodeKind === "task") {
    const slices = extractRawTaskSlices(entry, data.taskKey);
    return slices.length > 0 ? { kind: "task-slices", slices } : undefined;
  }

  const subEntries = collectSubResourceEntries(planEntries, data.resourceKey);
  if (subEntries !== undefined) {
    return { kind: "entry-with-subs", entries: subEntries };
  }

  return { kind: "entry", data: entry };
};
