import { mapActionToDiffState } from "../parser/map-diff-state.ts";
import type { PreparedJob, PreparedTask } from "../preparation/prepare-job.ts";
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
import type { ChangeDesc, PlanEntry } from "../types/plan-schema.ts";
import type { PreparedPlan } from "../types/prepared-plan.ts";
import type { NormalizedEntry } from "../utils/normalize-plan.ts";
import { buildTaskNodeId, extractResourceName } from "../utils/resource-key.ts";
import { hasFieldDrift, hasTaskDriftWithContext } from "../utils/structural-diff.ts";
import { buildTaskKeyPrefix, collectChangesForTask } from "../utils/task-key.ts";
import { isUnknownRecord } from "../utils/unknown-record.ts";
import { buildJobFields, isJobEntry } from "./build-resource-nodes.ts";
import {
  buildFinalRunJobTargets,
  buildJobIdMap,
  type FinalRunJobTarget,
} from "./resolve-run-job-target.ts";
import { classifyChange, resolveTaskDiffState } from "./resolve-task-diff-state.ts";

/** Create a job-level graph node for a plan entry. */
const buildJobNode = (
  resourceKey: string,
  entry: NormalizedEntry,
  tasks: readonly PreparedTask[],
  preparedJob: PreparedJob,
): JobGraphNode => ({
  id: resourceKey,
  nodeKind: "job",
  resourceKey,
  effects: entry.effects,
  ...buildJobFields(resourceKey, entry, tasks, preparedJob),
});

/** Create task-level graph nodes from extracted tasks. */
const buildTaskNodes = (
  resourceKey: string,
  entry: PlanEntry,
  tasks: readonly PreparedTask[],
  runJobTargets: ReadonlyMap<string, FinalRunJobTarget>,
): readonly TaskGraphNode[] => {
  const resourceHasShapeDrift = hasFieldDrift(entry.changes);
  const driftParent = {
    newState: entry.new_state,
    remoteState: entry.remote_state,
    resourceHasShapeDrift,
  };
  return tasks.map((task) => {
    const rawState = task.rawState;
    const target = runJobTargets.get(buildTaskNodeId(resourceKey, task.taskKey));
    const resourceState =
      target?.kind === "managed"
        ? annotateRunJobTaskState(rawState, extractResourceName(target.resourceKey))
        : rawState;

    return {
      id: buildTaskNodeId(resourceKey, task.taskKey),
      label: task.taskKey,
      nodeKind: "task" as const,
      diffState: resolveTaskDiffState(task.taskKey, entry.action, entry.changes),
      resourceKey,
      taskKey: task.taskKey,
      changes: filterTaskChanges(task.taskKey, entry.changes),
      resourceState,
      // Task nodes carry the parent job's raw pre-fuse state because their change
      // keys (`tasks[task_key='X'].depends_on[...]`) are rooted at the job level.
      // See BaseGraphNode.newState for why pre-fuse matters (dagshund-1naj).
      newState: entry.new_state,
      remoteState: entry.remote_state,
      // Inherit the parent job's drift flag — a task-level list-element delete
      // is drift iff the enclosing job independently shows shape-based drift
      // (e.g. `drift_pipeline.edit_mode`). Matches Python's `_render_resource`
      // which computes `resource_has_shape_drift(entry)` at the job level and
      // threads it into every field's ctx (dagshund-1naj, dagshund-15yh).
      resourceHasShapeDrift,
      isDrift: hasTaskDriftWithContext(task.taskKey, entry.changes, driftParent),
    };
  });
};

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
  tasks: readonly PreparedTask[],
): ReadonlyMap<string, ReadonlySet<string>> =>
  new Map(
    tasks.map((task) => [task.taskKey, new Set(task.dependencies.map((dep) => dep.task_key))]),
  );

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
  allTasks: readonly PreparedTask[],
  historicalTasks: readonly PreparedTask[],
  entry: PlanEntry,
): readonly GraphEdge[] => {
  const edgeDiffState = toEdgeDiffState(mapActionToDiffState(entry.action));
  const remoteDepsMap = buildRemoteDependsOnMap(historicalTasks);
  const emptySet: ReadonlySet<string> = new Set();

  return allTasks.flatMap((task) =>
    buildEdgesForTask(
      resourceKey,
      task.taskKey,
      task.dependencies,
      remoteDepsMap.get(task.taskKey) ?? emptySet,
      edgeDiffState,
      entry.changes,
    ),
  );
};

/** Build the complete graph for a single plan entry. */
const buildEntryGraph = (
  resourceKey: string,
  entry: NormalizedEntry,
  plan: PreparedPlan,
  runJobTargets: ReadonlyMap<string, FinalRunJobTarget>,
): { readonly nodes: readonly GraphNode[]; readonly edges: readonly GraphEdge[] } => {
  const projection = plan.byResourceKey.get(resourceKey)?.job;
  const job = projection?.status === "supported" ? projection.value : undefined;
  const tasks = job?.currentTasks.status === "supported" ? job.currentTasks.value : [];
  const deletedTasks = job?.deletedTasks.status === "supported" ? job.deletedTasks.value : [];
  const historicalTasks =
    job?.historicalTasks.status === "supported" ? job.historicalTasks.value : [];
  const allTasks = [...tasks, ...deletedTasks];

  return {
    nodes: [
      buildJobNode(resourceKey, entry, tasks, job ?? EMPTY_PREPARED_JOB),
      ...buildTaskNodes(resourceKey, entry, allTasks, runJobTargets),
    ],
    edges: buildDiffEdges(resourceKey, allTasks, historicalTasks, entry),
  };
};

const EMPTY_PREPARED_JOB: PreparedJob = {
  jobState: { status: "absent" },
  currentTasks: { status: "absent" },
  historicalTasks: { status: "absent" },
  deletedTasks: { status: "absent" },
  clusters: { status: "absent" },
};

/** Replace run_job_task.job_id with an annotated string showing the resolved target name. */
const annotateRunJobTaskState = (
  resourceState: Readonly<Record<string, unknown>>,
  targetName: string,
): Readonly<Record<string, unknown>> => {
  const runJobTask = resourceState["run_job_task"];
  if (!isUnknownRecord(runJobTask)) return resourceState;
  const jobId = runJobTask["job_id"];
  if (jobId === undefined) return resourceState;
  return {
    ...resourceState,
    run_job_task: { ...runJobTask, job_id: `${jobId} (${targetName})` },
  };
};

/** Create edges from tasks with run_job_task to the target job.
 *  Includes deleted tasks so that removed cross-job edges are visible in the graph. */
const buildRunJobEdges = (
  entries: readonly (readonly [string, PlanEntry])[],
  plan: PreparedPlan,
  runJobTargets: ReadonlyMap<string, FinalRunJobTarget>,
): readonly GraphEdge[] =>
  entries.flatMap(([resourceKey, entry]) => {
    const projection = plan.byResourceKey.get(resourceKey)?.job;
    const job = projection?.status === "supported" ? projection.value : undefined;
    const tasks = [
      ...(job?.currentTasks.status === "supported" ? job.currentTasks.value : []),
      ...(job?.deletedTasks.status === "supported" ? job.deletedTasks.value : []),
    ];
    return tasks.flatMap((task) => {
      const target = runJobTargets.get(buildTaskNodeId(resourceKey, task.taskKey));
      if (target?.kind !== "managed") return [];
      const targetResourceKey = target.resourceKey;
      const sourceNodeId = buildTaskNodeId(resourceKey, task.taskKey);
      const diffState = toEdgeDiffState(
        resolveTaskDiffState(task.taskKey, entry.action, entry.changes),
      );
      return [buildGraphEdge(sourceNodeId, targetResourceKey, diffState)];
    });
  });

/** Build the complete plan graph from job entries only. */
export const buildPlanGraph = (plan: PreparedPlan): PlanGraph => {
  const entries = Object.entries(plan.normalized.entries).filter(([key]) => isJobEntry(key));
  const jobIdMap = buildJobIdMap(entries);
  const runJobTargets = buildFinalRunJobTargets(entries, plan, jobIdMap);
  const graphs = entries.map(([key, entry]) => buildEntryGraph(key, entry, plan, runJobTargets));
  return {
    nodes: graphs.flatMap((graph) => graph.nodes),
    edges: [
      ...graphs.flatMap((graph) => graph.edges),
      ...buildRunJobEdges(entries, plan, runJobTargets),
    ],
  };
};
