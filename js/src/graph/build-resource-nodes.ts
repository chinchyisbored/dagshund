import { isStateCleanup, mapEntryToDiffState } from "../parser/map-diff-state.ts";
import type { PreparedJob, PreparedTask } from "../preparation/prepare-job.ts";
import type { DerivedGraphNode, ResourceGraphNode } from "../types/graph-types.ts";
import type { PlanEntry } from "../types/plan-schema.ts";
import type { Projection } from "../types/prepared-plan.ts";
import type { NormalizedEntry } from "../utils/normalize-plan.ts";
import { extractResourceName } from "../utils/resource-key.ts";
import { hasAnyDriftWithContext, hasFieldDrift } from "../utils/structural-diff.ts";
import { filterJobLevelChanges } from "../utils/task-key.ts";
import { buildTaskChangeSummary } from "./build-task-change-summary.ts";
import {
  buildDerivedNodeId,
  type DerivedNodeRef,
  extractDerivedNodeLabel,
} from "./derived-node-specs.ts";

/** Check whether a plan key represents a job entry. */
export const isJobEntry = (key: string): boolean => key.startsWith("resources.jobs.");

/** Shared fields for job nodes across both plan and resource graph views. */
export const buildJobFields = (
  resourceKey: string,
  entry: PlanEntry,
  tasks: readonly PreparedTask[],
  preparedJob: PreparedJob,
) => {
  const resourceHasShapeDrift = !isStateCleanup(entry) && hasFieldDrift(entry.changes);
  const driftParent = {
    newState: entry.new_state,
    remoteState: entry.remote_state,
    resourceHasShapeDrift,
  };
  return {
    label: extractResourceName(resourceKey),
    isStateCleanup: isStateCleanup(entry),
    stateCleanupGone: entry.gone === true,
    stateCleanups: entry.stateCleanups,
    diffState: mapEntryToDiffState(entry),
    changes: filterJobLevelChanges(entry.changes),
    resourceState:
      preparedJob.jobState.status === "supported" ? preparedJob.jobState.value : undefined,
    newState: entry.new_state,
    remoteState: entry.remote_state,
    resourceHasShapeDrift,
    taskChangeSummary: buildTaskChangeSummary(
      tasks,
      entry.action,
      entry.changes,
      driftParent,
      isStateCleanup(entry),
    ),
    // Scanned against raw `entry.changes` — `filterJobLevelChanges` above strips
    // the `tasks[...]` entries that carry whole-task drift, so the scan must
    // happen here before the filter can hide the signal.
    isDrift: !isStateCleanup(entry) && hasAnyDriftWithContext(entry.changes, driftParent),
  };
};

/** Build a GraphNode for a real plan resource entry. Container-tier resources
 *  (catalogs, projects) pass a hierarchy override for the node ID and label. */
export const buildResourceNode = (
  key: string,
  entry: NormalizedEntry,
  hierarchy: { readonly id: string; readonly label?: string } | undefined,
  preparedJob: PreparedJob | undefined,
  currentState: Projection<Readonly<Record<string, unknown>>>,
): ResourceGraphNode => {
  if (isJobEntry(key)) {
    const job = preparedJob ?? {
      jobState: { status: "absent" },
      currentTasks: { status: "absent" },
      historicalTasks: { status: "absent" },
      deletedTasks: { status: "absent" },
      clusters: { status: "absent" },
      fileArrivalUrl: { status: "absent" },
    };
    const tasks = job.currentTasks.status === "supported" ? job.currentTasks.value : [];
    return {
      id: key,
      nodeKind: "resource",
      resourceKey: key,
      effects: entry.effects,
      ...buildJobFields(key, entry, tasks, job),
    };
  }
  const resourceHasShapeDrift = !isStateCleanup(entry) && hasFieldDrift(entry.changes);
  return {
    id: hierarchy?.id ?? key,
    label: hierarchy?.label ?? extractResourceName(key),
    nodeKind: "resource",
    isStateCleanup: isStateCleanup(entry),
    stateCleanupGone: entry.gone === true,
    stateCleanups: entry.stateCleanups,
    diffState: mapEntryToDiffState(entry),
    resourceKey: key,
    changes: entry.changes,
    resourceState: currentState.status === "supported" ? currentState.value : undefined,
    newState: entry.new_state,
    remoteState: entry.remote_state,
    resourceHasShapeDrift,
    taskChangeSummary: undefined,
    isDrift:
      !isStateCleanup(entry) &&
      hasAnyDriftWithContext(entry.changes, {
        newState: entry.new_state,
        remoteState: entry.remote_state,
        resourceHasShapeDrift,
      }),
  };
};

export const buildDerivedNode = (
  ownerResourceKey: string,
  ownerEntry: PlanEntry,
  ref: DerivedNodeRef,
): DerivedGraphNode => {
  const id = buildDerivedNodeId(ref.derivedKind, ref.identity);
  return {
    id,
    label: extractDerivedNodeLabel(ref.derivedKind, ownerResourceKey, ref.identity),
    nodeKind: "derived",
    derivedKind: ref.derivedKind,
    ownerResourceKey,
    diffState: mapEntryToDiffState(ownerEntry),
    resourceKey: id,
    changes: undefined,
    resourceState: undefined,
    newState: undefined,
    remoteState: undefined,
    resourceHasShapeDrift: false,
  };
};
