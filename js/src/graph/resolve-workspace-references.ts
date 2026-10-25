import type { PreparedCluster } from "../preparation/prepare-job.ts";
import type { ReferenceResolution } from "../types/reference-resolution.ts";
import { extractResourceType } from "../utils/resource-key.ts";
import { extractStateField } from "./extract-resource-state.ts";
import { extractBundleResourceIdRef } from "./postgres-paths.ts";
import type { ReferenceResolutionContext } from "./reference-resolution-context.ts";

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
const extractPreparedClusterPools = (cluster: PreparedCluster): readonly string[] =>
  [cluster.instancePoolId, cluster.driverInstancePoolId].filter(
    (reference): reference is string => reference !== undefined,
  );

export const resolveInstancePoolReferences = (
  sourceResourceKey: string,
  context: ReferenceResolutionContext,
): readonly ReferenceResolution[] => {
  const resourceType = extractResourceType(sourceResourceKey);
  const entry = context.entries.find(([key]) => key === sourceResourceKey)?.[1];
  if (entry === undefined || !["clusters", "jobs", "pipelines"].includes(resourceType ?? ""))
    return [];
  const references =
    resourceType === "jobs"
      ? ((): readonly string[] => {
          const job = context.preparedPlan.byResourceKey.get(sourceResourceKey)?.job;
          return job?.status === "supported" && job.value.clusters.status === "supported"
            ? job.value.clusters.value.flatMap(extractPreparedClusterPools)
            : [];
        })()
      : ((): readonly string[] => {
          const pools =
            context.preparedPlan.byResourceKey.get(sourceResourceKey)?.instancePoolReferences;
          return pools?.status === "supported" ? pools.value : [];
        })();
  return references.flatMap((reference) => {
    const targetKey = extractBundleResourceIdRef(reference);
    if (
      targetKey === undefined ||
      extractResourceType(targetKey) !== "instance_pools" ||
      reference !== `\${${targetKey}.id}`
    )
      return [];
    const targetNodeId = context.identityCatalog.nodeIdByResourceKey.get(targetKey);
    return targetNodeId === undefined
      ? []
      : [resolveResolvedTarget(sourceResourceKey, targetKey, targetNodeId)];
  });
};

export const resolveVectorEndpointReference = (
  sourceResourceKey: string,
  context: ReferenceResolutionContext,
): readonly ReferenceResolution[] => {
  if (extractResourceType(sourceResourceKey) !== "vector_search_indexes") return [];
  const entry = context.entries.find(([key]) => key === sourceResourceKey)?.[1];
  const endpointName = entry === undefined ? undefined : extractStateField(entry, "endpoint_name");
  if (endpointName === undefined) return [];
  const symbolicTarget = extractBundleResourceIdRef(endpointName);
  const targetKey =
    symbolicTarget !== undefined &&
    extractResourceType(symbolicTarget) === "vector_search_endpoints" &&
    endpointName === `\${${symbolicTarget}.name}`
      ? symbolicTarget
      : symbolicTarget === undefined
        ? context.entries.find(
            ([key, target]) =>
              extractResourceType(key) === "vector_search_endpoints" &&
              extractStateField(target, "name") === endpointName,
          )?.[0]
        : undefined;
  const targetNodeId =
    targetKey === undefined
      ? undefined
      : context.identityCatalog.nodeIdByResourceKey.get(targetKey);
  return targetKey !== undefined && targetNodeId !== undefined
    ? [resolveResolvedTarget(sourceResourceKey, targetKey, targetNodeId)]
    : [];
};
