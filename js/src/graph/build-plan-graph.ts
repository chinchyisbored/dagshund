import { mapActionToDiffState } from "../parser/map-diff-state.ts";
import {
  buildGraphEdge,
  type EdgeDiffState,
  type GraphEdge,
  type GraphNode,
  type JobGraphNode,
  type PlanGraph,
  type TaskGraphNode,
  toEdgeDiffState,
} from "../types/graph-types.ts";
import type { ChangeDesc, Plan, PlanEntry } from "../types/plan-schema.ts";
import { mergeSubResources } from "../utils/merge-sub-resources.ts";
import { buildTaskKeyPrefix, collectChangesForTask } from "../utils/task-key.ts";
import { getUnknownProp, isUnknownRecord } from "../utils/unknown-record.ts";
import { buildJobFields, isJobEntry } from "./build-resource-graph.ts";
import {
  extractDeletedTaskEntries,
  extractTaskEntriesFromRemoteState,
  extractTaskState,
  resolveAllTaskEntries,
  resolveTaskEntries,
  type TaskEntry,
} from "./extract-tasks.ts";
import { classifyChange, resolveTaskDiffState } from "./resolve-task-diff-state.ts";

/** Create a unique node ID for a task within a resource. */
const buildTaskNodeId = (resourceKey: string, taskKey: string): string =>
  `${resourceKey}::${taskKey}`;

/** Create a job-level graph node for a plan entry. */
const buildJobNode = (
  resourceKey: string,
  entry: PlanEntry,
  tasks: readonly TaskEntry[],
): JobGraphNode => ({
  id: resourceKey,
  nodeKind: "job",
  resourceKey,
  ...buildJobFields(resourceKey, entry, tasks),
});

/** Create task-level graph nodes from extracted tasks. */
const buildTaskNodes = (
  resourceKey: string,
  entry: PlanEntry,
  tasks: readonly TaskEntry[],
): readonly TaskGraphNode[] =>
  tasks.map((task) => ({
    id: buildTaskNodeId(resourceKey, task.task_key),
    label: task.task_key,
    nodeKind: "task" as const,
    diffState: resolveTaskDiffState(task.task_key, entry.action, entry.changes),
    resourceKey,
    taskKey: task.task_key,
    changes: filterTaskChanges(task.task_key, entry.changes),
    resourceState: extractTaskState(task),
  }));

/** Filter changes to only include entries for a specific task. */
const filterTaskChanges = (
  taskKey: string,
  changes: Readonly<Record<string, ChangeDesc>> | undefined,
): Readonly<Record<string, ChangeDesc>> | undefined => {
  if (changes === undefined) return undefined;
  const entries = collectChangesForTask(taskKey, changes);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
};

/** Build a map from task_key to its old dependency keys from remote_state. */
const buildRemoteDependsOnMap = (
  remoteState: unknown,
): ReadonlyMap<string, ReadonlySet<string>> => {
  const tasks = extractTaskEntriesFromRemoteState(remoteState);
  return new Map(
    tasks.map((t) => [t.task_key, new Set((t.depends_on ?? []).map((d) => d.task_key))]),
  );
};

/** Resolve edge diff state for a single dependency given the depends_on change. */
const resolveDepEdgeDiffState = (
  depTaskKey: string,
  oldKeys: ReadonlySet<string>,
  newKeys: ReadonlySet<string>,
): EdgeDiffState => {
  const inOld = oldKeys.has(depTaskKey);
  const inNew = newKeys.has(depTaskKey);
  if (inNew && !inOld) return "added";
  if (inOld && !inNew) return "removed";
  return "unchanged";
};

/** Determine if a whole-task change represents an addition or removal. */
const resolveTaskEdgeDiffState = (
  taskKey: string,
  changes: Readonly<Record<string, ChangeDesc>> | undefined,
): EdgeDiffState | undefined => {
  const wholeTaskChange = changes?.[buildTaskKeyPrefix(taskKey)];
  if (wholeTaskChange === undefined) return undefined;
  const classification = classifyChange(wholeTaskChange);
  return classification === "added" || classification === "removed" ? classification : undefined;
};

/** Create a single dependency edge from depTaskKey → taskKey within resourceKey. */
const buildDepEdge = (
  resourceKey: string,
  depTaskKey: string,
  taskKey: string,
  diffState: EdgeDiffState,
): GraphEdge =>
  buildGraphEdge(
    buildTaskNodeId(resourceKey, depTaskKey),
    buildTaskNodeId(resourceKey, taskKey),
    diffState,
  );

/** Build edges with diff states for a single task's dependencies.
 *  Handles create/delete at the resource and task levels, then compares
 *  old (remote_state) vs new depends_on to detect added/removed edges. */
const buildEdgesForTask = (
  resourceKey: string,
  taskKey: string,
  currentDependsOn: readonly { readonly task_key: string }[],
  oldDependsOnKeys: ReadonlySet<string>,
  resourceDiffState: EdgeDiffState,
  changes: Readonly<Record<string, ChangeDesc>> | undefined,
): readonly GraphEdge[] => {
  // Resource-level create or delete: all edges inherit that state
  if (resourceDiffState !== "unchanged") {
    return currentDependsOn.map((dep) =>
      buildDepEdge(resourceKey, dep.task_key, taskKey, resourceDiffState),
    );
  }

  // Task-level create or delete: all edges inherit the task's state
  const taskEdgeDiffState = resolveTaskEdgeDiffState(taskKey, changes);
  if (taskEdgeDiffState !== undefined) {
    return currentDependsOn.map((dep) =>
      buildDepEdge(resourceKey, dep.task_key, taskKey, taskEdgeDiffState),
    );
  }

  // Compare old (remote_state) vs new depends_on directly
  const newKeys = new Set(currentDependsOn.map((d) => d.task_key));
  const allDepKeys = new Set([...oldDependsOnKeys, ...newKeys]);
  return [...allDepKeys].map((depTaskKey) =>
    buildDepEdge(
      resourceKey,
      depTaskKey,
      taskKey,
      resolveDepEdgeDiffState(depTaskKey, oldDependsOnKeys, newKeys),
    ),
  );
};

/** Build diff-aware edges for all tasks within a resource. */
const buildDiffEdges = (
  resourceKey: string,
  allTasks: readonly TaskEntry[],
  entry: PlanEntry,
): readonly GraphEdge[] => {
  const edgeDiffState = toEdgeDiffState(mapActionToDiffState(entry.action));
  const remoteDepsMap = buildRemoteDependsOnMap(entry.remote_state);
  const emptySet: ReadonlySet<string> = new Set();

  return allTasks.flatMap((task) =>
    buildEdgesForTask(
      resourceKey,
      task.task_key,
      task.depends_on ?? [],
      remoteDepsMap.get(task.task_key) ?? emptySet,
      edgeDiffState,
      entry.changes,
    ),
  );
};

/** Build the complete graph for a single plan entry. */
const buildEntryGraph = (
  resourceKey: string,
  entry: PlanEntry,
): { readonly nodes: readonly GraphNode[]; readonly edges: readonly GraphEdge[] } => {
  const tasks = resolveTaskEntries(entry.new_state, entry.remote_state);
  const deletedTasks = extractDeletedTaskEntries(entry.changes);
  const allTasks = [...tasks, ...deletedTasks];

  return {
    nodes: [
      buildJobNode(resourceKey, entry, tasks),
      ...buildTaskNodes(resourceKey, entry, allTasks),
    ],
    edges: buildDiffEdges(resourceKey, allTasks, entry),
  };
};

/** Extract a resource key from a Databricks bundle interpolation like "${resources.jobs.X.id}". */
const INTERPOLATION_PATTERN = /^\$\{(resources\..+?)\.id\}$/;

const parseResourceReference = (interpolation: string): string | undefined =>
  INTERPOLATION_PATTERN.exec(interpolation)?.[1];

/** Build a map from numeric remote_state.job_id to resource key for cross-job resolution. */
const buildJobIdMap = (
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

/** Create edges from tasks with run_job_task to the target job.
 *  Includes deleted tasks so that removed cross-job edges are visible in the graph. */
const buildRunJobEdges = (
  entries: readonly (readonly [string, PlanEntry])[],
): readonly GraphEdge[] => {
  const jobIdMap = buildJobIdMap(entries);
  return entries.flatMap(([resourceKey, entry]) => {
    const allTasks = resolveAllTaskEntries(entry.new_state, entry.remote_state, entry.changes);
    return allTasks.flatMap((task) => {
      const jobId = task.run_job_task?.job_id;
      if (jobId === undefined) return [];
      const sourceNodeId = buildTaskNodeId(resourceKey, task.task_key);
      const targetResourceKey =
        typeof jobId === "string"
          ? parseResourceReference(jobId)
          : (jobIdMap.get(jobId) ?? resolveRunJobTargetFromVars(entry.new_state, task.task_key));
      if (targetResourceKey === undefined) return [];
      const diffState = toEdgeDiffState(
        resolveTaskDiffState(task.task_key, entry.action, entry.changes),
      );
      return [buildGraphEdge(sourceNodeId, targetResourceKey, diffState)];
    });
  });
};

/** Build the complete plan graph from job entries only. */
export const buildPlanGraph = (plan: Plan): PlanGraph => {
  const entries = Object.entries(mergeSubResources(plan.plan ?? {})).filter(([key]) =>
    isJobEntry(key),
  );
  const graphs = entries.map(([key, entry]) => buildEntryGraph(key, entry));
  return {
    nodes: graphs.flatMap((graph) => graph.nodes),
    edges: [...graphs.flatMap((graph) => graph.edges), ...buildRunJobEdges(entries)],
  };
};
