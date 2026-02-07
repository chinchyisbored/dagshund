import { mapActionToDiffState } from "../parser/map-diff-state.ts";
import type { EdgeDiffState, GraphEdge, GraphNode, PlanGraph } from "../types/graph-types.ts";
import type { ChangeDesc, Plan, PlanEntry } from "../types/plan-schema.ts";
import { buildTaskChangeSummary } from "./build-task-change-summary.ts";
import {
  extractDeletedTaskEntries,
  extractJobState,
  extractTaskEntries,
  extractTaskState,
  type TaskEntry,
} from "./extract-tasks.ts";
import { resolveTaskDiffState } from "./resolve-task-diff-state.ts";

/** Create a unique node ID for a task within a resource. */
const buildTaskNodeId = (resourceKey: string, taskKey: string): string =>
  `${resourceKey}::${taskKey}`;

/** Create a job-level graph node for a plan entry. */
const buildJobNode = (
  resourceKey: string,
  entry: PlanEntry,
  tasks: readonly TaskEntry[],
): GraphNode => ({
  id: resourceKey,
  label: resourceKey,
  nodeKind: "job",
  diffState: mapActionToDiffState(entry.action),
  resourceKey,
  taskKey: undefined,
  changes: filterJobLevelChanges(entry.changes),
  resourceState: extractJobState(entry.new_state),
  taskChangeSummary: buildTaskChangeSummary(tasks, entry.action, entry.changes),
});

/** Filter changes to only include job-level (non-task) entries. */
const filterJobLevelChanges = (
  changes: Readonly<Record<string, ChangeDesc>> | undefined,
): Readonly<Record<string, ChangeDesc>> | undefined => {
  if (changes === undefined) return undefined;
  const entries = Object.entries(changes).filter(([key]) => !key.startsWith("tasks["));
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
};

/** Create task-level graph nodes from extracted tasks. */
const buildTaskNodes = (
  resourceKey: string,
  entry: PlanEntry,
  tasks: readonly TaskEntry[],
): readonly GraphNode[] =>
  tasks.map((task) => ({
    id: buildTaskNodeId(resourceKey, task.task_key),
    label: task.task_key,
    nodeKind: "task" as const,
    diffState: resolveTaskDiffState(task.task_key, entry.action, entry.changes),
    resourceKey,
    taskKey: task.task_key,
    changes: filterTaskChanges(task.task_key, entry.changes),
    resourceState: extractTaskState(task),
    taskChangeSummary: undefined,
  }));

/** Filter changes to only include entries for a specific task. */
const filterTaskChanges = (
  taskKey: string,
  changes: Readonly<Record<string, ChangeDesc>> | undefined,
): Readonly<Record<string, ChangeDesc>> | undefined => {
  if (changes === undefined) return undefined;
  const prefix = `tasks[task_key='${taskKey}']`;
  const entries = Object.entries(changes).filter(([key]) => key.startsWith(prefix));
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
};

/** Extract task_key values from a depends_on array (typed as unknown from changes). */
const extractDependsOnKeys = (dependsOn: unknown): ReadonlySet<string> => {
  if (!Array.isArray(dependsOn)) return new Set();
  const keys = new Set<string>();
  for (const entry of dependsOn) {
    if (typeof entry === "object" && entry !== null && "task_key" in entry) {
      const taskKey = (entry as { readonly task_key: string }).task_key;
      if (typeof taskKey === "string") keys.add(taskKey);
    }
  }
  return keys;
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
  const wholeTaskChange = changes?.[`tasks[task_key='${taskKey}']`];
  if (wholeTaskChange === undefined) return undefined;
  if (wholeTaskChange.new !== undefined && wholeTaskChange.old === undefined) return "added";
  if (wholeTaskChange.old !== undefined && wholeTaskChange.new === undefined) return "removed";
  return undefined;
};

/** Build edges with diff states for a single task's dependencies.
 *  Handles create/delete at the resource and task levels, depends_on changes, and unchanged deps. */
const buildEdgesForTask = (
  resourceKey: string,
  taskKey: string,
  currentDependsOn: readonly { readonly task_key: string }[],
  resourceDiffState: EdgeDiffState,
  changes: Readonly<Record<string, ChangeDesc>> | undefined,
): readonly GraphEdge[] => {
  // Resource-level create or delete: all edges inherit that state
  if (resourceDiffState !== "unchanged") {
    return currentDependsOn.map((dep) => ({
      id: `${buildTaskNodeId(resourceKey, dep.task_key)}→${buildTaskNodeId(resourceKey, taskKey)}`,
      source: buildTaskNodeId(resourceKey, dep.task_key),
      target: buildTaskNodeId(resourceKey, taskKey),
      label: undefined,
      diffState: resourceDiffState,
    }));
  }

  // Task-level create or delete: all edges inherit the task's state
  const taskEdgeDiffState = resolveTaskEdgeDiffState(taskKey, changes);
  if (taskEdgeDiffState !== undefined) {
    return currentDependsOn.map((dep) => ({
      id: `${buildTaskNodeId(resourceKey, dep.task_key)}→${buildTaskNodeId(resourceKey, taskKey)}`,
      source: buildTaskNodeId(resourceKey, dep.task_key),
      target: buildTaskNodeId(resourceKey, taskKey),
      label: undefined,
      diffState: taskEdgeDiffState,
    }));
  }

  const dependsOnChangeKey = `tasks[task_key='${taskKey}'].depends_on`;
  const dependsOnChange = changes?.[dependsOnChangeKey];

  if (dependsOnChange === undefined) {
    // No depends_on change: all edges are unchanged
    return currentDependsOn.map((dep) => ({
      id: `${buildTaskNodeId(resourceKey, dep.task_key)}→${buildTaskNodeId(resourceKey, taskKey)}`,
      source: buildTaskNodeId(resourceKey, dep.task_key),
      target: buildTaskNodeId(resourceKey, taskKey),
      label: undefined,
      diffState: "unchanged" as const,
    }));
  }

  // Compare old vs new depends_on arrays
  const oldKeys = extractDependsOnKeys(dependsOnChange.old);
  const newKeys = extractDependsOnKeys(dependsOnChange.new);

  // Build edges for all deps in the union of old and new
  const allDepKeys = new Set([...oldKeys, ...newKeys]);
  return [...allDepKeys].map((depTaskKey) => {
    const diffState = resolveDepEdgeDiffState(depTaskKey, oldKeys, newKeys);
    return {
      id: `${buildTaskNodeId(resourceKey, depTaskKey)}→${buildTaskNodeId(resourceKey, taskKey)}`,
      source: buildTaskNodeId(resourceKey, depTaskKey),
      target: buildTaskNodeId(resourceKey, taskKey),
      label: undefined,
      diffState,
    };
  });
};

/** Build diff-aware edges for all tasks within a resource. */
const buildDiffEdges = (
  resourceKey: string,
  allTasks: readonly TaskEntry[],
  entry: PlanEntry,
): readonly GraphEdge[] => {
  const resourceDiff = mapActionToDiffState(entry.action);
  const edgeDiffState: EdgeDiffState =
    resourceDiff === "added" ? "added" : resourceDiff === "removed" ? "removed" : "unchanged";

  return allTasks.flatMap((task) =>
    buildEdgesForTask(
      resourceKey,
      task.task_key,
      task.depends_on ?? [],
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
  const tasks = extractTaskEntries(entry.new_state);
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
      const jobId = (remoteState as { readonly job_id: unknown }).job_id;
      if (typeof jobId === "number") {
        map.set(jobId, resourceKey);
      }
    }
  }
  return map;
};

/** Create edges from tasks with run_job_task to the target job. */
const buildRunJobEdges = (
  entries: readonly (readonly [string, PlanEntry])[],
): readonly GraphEdge[] => {
  const jobIdMap = buildJobIdMap(entries);
  return entries.flatMap(([resourceKey, entry]) => {
    const tasks = extractTaskEntries(entry.new_state);
    return tasks.flatMap((task) => {
      const jobId = task.run_job_task?.job_id;
      if (jobId === undefined) return [];
      const targetResourceKey =
        typeof jobId === "string"
          ? parseResourceReference(jobId)
          : jobIdMap.get(jobId);
      if (targetResourceKey === undefined) return [];
      const sourceNodeId = buildTaskNodeId(resourceKey, task.task_key);
      return [
        {
          id: `${sourceNodeId}→${targetResourceKey}`,
          source: sourceNodeId,
          target: targetResourceKey,
          label: undefined,
          diffState: "unchanged" as const,
        },
      ];
    });
  });
};

/** Build the complete plan graph from all plan entries. */
export const buildPlanGraph = (plan: Plan): PlanGraph => {
  const entries = Object.entries(plan.plan ?? {});
  const graphs = entries.map(([key, entry]) => buildEntryGraph(key, entry));
  return {
    nodes: graphs.flatMap((g) => g.nodes),
    edges: [...graphs.flatMap((g) => g.edges), ...buildRunJobEdges(entries)],
  };
};
