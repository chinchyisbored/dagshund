import { mapActionToDiffState } from "../parser/map-diff-state.ts";
import type { GraphEdge, GraphNode, PlanGraph } from "../types/graph-types.ts";
import type { ChangeDesc, Plan, PlanEntry } from "../types/plan-schema.ts";
import { buildTaskChangeSummary } from "./build-task-change-summary.ts";
import {
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

/** Create edges between task nodes based on depends_on relationships. */
const buildTaskEdges = (resourceKey: string, tasks: readonly TaskEntry[]): readonly GraphEdge[] =>
  tasks.flatMap((task) =>
    (task.depends_on ?? []).map((dep) => ({
      id: `${buildTaskNodeId(resourceKey, dep.task_key)}→${buildTaskNodeId(resourceKey, task.task_key)}`,
      source: buildTaskNodeId(resourceKey, dep.task_key),
      target: buildTaskNodeId(resourceKey, task.task_key),
      label: undefined,
    })),
  );

/** Build the complete graph for a single plan entry. */
const buildEntryGraph = (
  resourceKey: string,
  entry: PlanEntry,
): { readonly nodes: readonly GraphNode[]; readonly edges: readonly GraphEdge[] } => {
  const tasks = extractTaskEntries(entry.new_state);
  return {
    nodes: [buildJobNode(resourceKey, entry, tasks), ...buildTaskNodes(resourceKey, entry, tasks)],
    edges: buildTaskEdges(resourceKey, tasks),
  };
};

/** Extract a resource key from a Databricks bundle interpolation like "${resources.jobs.X.id}". */
const INTERPOLATION_PATTERN = /^\$\{(resources\..+?)\.id\}$/;

const parseResourceReference = (interpolation: string): string | undefined =>
  INTERPOLATION_PATTERN.exec(interpolation)?.[1];

/** Create edges from tasks with run_job_task to the target job. */
const buildRunJobEdges = (
  entries: readonly (readonly [string, PlanEntry])[],
): readonly GraphEdge[] =>
  entries.flatMap(([resourceKey, entry]) => {
    const tasks = extractTaskEntries(entry.new_state);
    return tasks.flatMap((task) => {
      const jobId = task.run_job_task?.job_id;
      if (jobId === undefined) return [];
      const targetResourceKey = parseResourceReference(jobId);
      if (targetResourceKey === undefined) return [];
      const sourceNodeId = buildTaskNodeId(resourceKey, task.task_key);
      return [
        {
          id: `${sourceNodeId}→${targetResourceKey}`,
          source: sourceNodeId,
          target: targetResourceKey,
          label: undefined,
        },
      ];
    });
  });

/** Build the complete plan graph from all plan entries. */
export const buildPlanGraph = (plan: Plan): PlanGraph => {
  const entries = Object.entries(plan.plan ?? {});
  const graphs = entries.map(([key, entry]) => buildEntryGraph(key, entry));
  return {
    nodes: graphs.flatMap((g) => g.nodes),
    edges: [...graphs.flatMap((g) => g.edges), ...buildRunJobEdges(entries)],
  };
};
