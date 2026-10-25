import type { ReferenceResolution } from "../types/reference-resolution.ts";
import {
  buildPrefixedNodeId,
  buildResourceKey,
  DATABASE_INSTANCE_SOURCE_TYPES,
  extractResourceType,
  SYNCED_TABLE_SOURCE_TYPES,
} from "../utils/resource-key.ts";
import { extractStateField } from "./extract-resource-state.ts";
import { extractBundleResourceIdRef } from "./postgres-paths.ts";
import type { ReferenceResolutionContext } from "./reference-resolution-context.ts";
import { resolvePipelineReference } from "./reference-specs.ts";

const resolveResolvedTarget = (
  sourceResourceKey: string,
  targetResourceKey: string,
  targetNodeId: string,
): ReferenceResolution => ({
  kind: "resolved",
  sourceResourceKey,
  targetNodeId,
  targetResourceKey,
  provenance: targetResourceKey.startsWith("postgres-synced-pipeline::") ? "derived" : "real",
  direction: "entry-to-target",
});
export const resolveDatabaseInstanceReference = (
  sourceResourceKey: string,
  context: ReferenceResolutionContext,
): ReferenceResolution[] => {
  if (!DATABASE_INSTANCE_SOURCE_TYPES.has(extractResourceType(sourceResourceKey) ?? "")) return [];
  const entry = context.entries.find(([key]) => key === sourceResourceKey)?.[1];
  const name = entry === undefined ? undefined : extractStateField(entry, "database_instance_name");
  if (name === undefined) return [];
  const targetKey = buildResourceKey("database_instances", name);
  const targetNodeId = context.identityCatalog.nodeIdByResourceKey.get(targetKey);
  if (targetNodeId !== undefined)
    return [resolveResolvedTarget(sourceResourceKey, targetKey, targetNodeId)];
  const phantomId = buildPrefixedNodeId("databaseInstance", name);
  return [
    {
      kind: "phantom",
      sourceResourceKey,
      targetNodeId: phantomId,
      resourceKey: targetKey,
      label: name,
      phantomKind: "databaseInstance",
      placement: { kind: "workspace-resource", resourceType: "database_instances" },
      direction: "entry-to-target",
    },
  ];
};

export const resolveExistingPipelineReference = (
  sourceResourceKey: string,
  context: ReferenceResolutionContext,
): ReferenceResolution[] => {
  if (!SYNCED_TABLE_SOURCE_TYPES.has(extractResourceType(sourceResourceKey) ?? "")) return [];
  const projection = context.preparedPlan.byResourceKey.get(sourceResourceKey)?.existingPipelineId;
  if (projection?.status !== "supported") return [];
  const reference = projection.value;
  const existingKeys = new Set(context.entries.map(([key]) => key));
  const indexedTarget = context.indexes.pipelineIndex.get(reference);
  const symbolicTarget = extractBundleResourceIdRef(reference);
  const knownTarget =
    (indexedTarget !== undefined &&
    (context.identityCatalog.nodeIdByResourceKey.has(indexedTarget) ||
      context.identityCatalog.nodeIdByAlias.has(`pipelines:${reference}`))
      ? indexedTarget
      : undefined) ??
    (symbolicTarget !== undefined &&
    extractResourceType(symbolicTarget) === "pipelines" &&
    context.identityCatalog.nodeIdByResourceKey.has(symbolicTarget)
      ? symbolicTarget
      : undefined);
  const targetKey =
    knownTarget ?? resolvePipelineReference(reference, context.indexes.pipelineIndex, existingKeys);
  const targetNodeId =
    context.identityCatalog.nodeIdByResourceKey.get(targetKey) ??
    context.identityCatalog.nodeIdByAlias.get(`pipelines:${reference}`);
  if (targetNodeId !== undefined && !targetKey.startsWith("pipeline::")) {
    return [resolveResolvedTarget(sourceResourceKey, targetKey, targetNodeId)];
  }
  const phantomId = buildPrefixedNodeId("pipeline", reference);
  return [
    {
      kind: "phantom",
      sourceResourceKey,
      targetNodeId: phantomId,
      resourceKey: phantomId,
      label: reference,
      phantomKind: "pipeline",
      placement: { kind: "workspace-resource", resourceType: "pipelines" },
      direction: "entry-to-target",
    },
  ];
};
