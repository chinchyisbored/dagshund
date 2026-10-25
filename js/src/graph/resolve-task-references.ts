import type { PreparedTask } from "../preparation/prepare-job.ts";
import type { ReferenceResolution } from "../types/reference-resolution.ts";
import { buildPrefixedNodeId, buildTaskNodeId } from "../utils/resource-key.ts";
import type { ReferenceResolutionContext } from "./reference-resolution-context.ts";
import { resolveTaskRefTargetKey, TASK_REF_SPECS } from "./reference-specs.ts";
import type { FinalRunJobTarget } from "./resolve-run-job-target.ts";

const resolveTaskReferences = (
  sourceResourceKey: string,
  task: PreparedTask,
  context: ReferenceResolutionContext,
): readonly ReferenceResolution[] =>
  TASK_REF_SPECS.flatMap((spec): readonly ReferenceResolution[] => {
    const reference = task.references[spec.referenceName];
    const value = reference?.status === "supported" ? reference.value : undefined;
    if (value === undefined) return [];
    const targetKey = resolveTaskRefTargetKey(value, spec, context.indexes);
    const phantomId = buildPrefixedNodeId(spec.phantomKind, value);
    if (targetKey === phantomId) {
      return [
        {
          kind: "phantom",
          sourceResourceKey,
          targetNodeId: phantomId,
          resourceKey: phantomId,
          label: value,
          phantomKind: spec.phantomKind,
          placement: { kind: "workspace-resource", resourceType: spec.targetResourceType },
          direction: "entry-to-target",
        },
      ];
    }
    const targetNodeId =
      context.identityCatalog.nodeIdByResourceKey.get(targetKey) ??
      context.identityCatalog.nodeIdByAlias.get(`${spec.targetResourceType}:${value}`);
    if (targetNodeId === undefined) return [];
    return [
      {
        kind: "resolved",
        sourceResourceKey,
        targetNodeId,
        targetResourceKey: targetKey,
        provenance: targetKey.startsWith("postgres-synced-pipeline::") ? "derived" : "real",
        direction: "entry-to-target",
      },
    ];
  });

const resolveRunJobReferences = (
  sourceResourceKey: string,
  task: PreparedTask,
  context: ReferenceResolutionContext,
  finalRunJobTargets: ReadonlyMap<string, FinalRunJobTarget>,
): readonly ReferenceResolution[] => {
  if (task.runJob.status !== "supported") return [];
  const target = finalRunJobTargets.get(buildTaskNodeId(sourceResourceKey, task.taskKey)) ?? {
    kind: "unsupported" as const,
  };
  if (target.kind === "managed") {
    const targetNodeId = context.identityCatalog.nodeIdByResourceKey.get(target.resourceKey);
    if (targetNodeId === undefined) return [];
    return [
      {
        kind: "resolved",
        sourceResourceKey,
        targetNodeId,
        targetResourceKey: target.resourceKey,
        provenance: "real",
        direction: "entry-to-target",
      },
    ];
  }
  if (target.kind === "unsupported") return [];
  const phantomId = buildPrefixedNodeId("job", String(target.jobId));
  return [
    {
      kind: "phantom",
      sourceResourceKey,
      targetNodeId: phantomId,
      resourceKey: phantomId,
      label: String(target.jobId),
      phantomKind: "job",
      placement: { kind: "workspace-resource", resourceType: "jobs" },
      direction: "entry-to-target",
    },
  ];
};

export const resolvePreparedTaskReferences = (
  sourceResourceKey: string,
  context: ReferenceResolutionContext,
  finalRunJobTargets: ReadonlyMap<string, FinalRunJobTarget>,
): readonly ReferenceResolution[] => {
  const job = context.preparedPlan.byResourceKey.get(sourceResourceKey)?.job;
  const tasks =
    job?.status === "supported" && job.value.currentTasks.status === "supported"
      ? job.value.currentTasks.value
      : [];
  return tasks.flatMap((task) => [
    ...resolveTaskReferences(sourceResourceKey, task, context),
    ...resolveRunJobReferences(sourceResourceKey, task, context, finalRunJobTargets),
  ]);
};
