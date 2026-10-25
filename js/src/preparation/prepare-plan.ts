import { z } from "zod/v4";
import type { PlanEntry } from "../types/plan-schema.ts";
import type {
  PreparationDiagnostic,
  PreparedPlan,
  PreparedResource,
  Projection,
} from "../types/prepared-plan.ts";
import { selectEffectiveResourceState } from "../utils/effective-resource-state.ts";
import type { NormalizedPlan } from "../utils/normalize-plan.ts";
import { extractResourceType, WAREHOUSE_SOURCE_TYPES } from "../utils/resource-key.ts";
import { getUnknownProp, isUnknownRecord } from "../utils/unknown-record.ts";
import { prepareAppResources } from "./prepare-app.ts";
import { prepareJob } from "./prepare-job.ts";
import { prepareResourceReferences } from "./prepare-resource-references.ts";
import { prepareServingEndpoint } from "./prepare-serving-endpoint.ts";

const currentStateSchema = z.record(z.string(), z.unknown()).readonly();

const prepareCurrentState = (
  resourceKey: string,
  entry: PlanEntry,
): {
  readonly projection: Projection<Readonly<Record<string, unknown>>>;
  readonly diagnostic: PreparationDiagnostic | undefined;
} => {
  const selected = selectEffectiveResourceState(entry);
  if (selected.origin === "absent")
    return { projection: { status: "absent" }, diagnostic: undefined };
  const parsed = currentStateSchema.safeParse(selected.snapshot);
  if (parsed.success)
    return { projection: { status: "supported", value: parsed.data }, diagnostic: undefined };
  const diagnostic: PreparationDiagnostic = {
    resourceKey,
    capability: "current-state",
    reason: "invalid-shape",
  };
  return { projection: { status: "unsupported", diagnostic }, diagnostic };
};

const prepareInstancePoolReferences = (
  resourceKey: string,
  resourceType: string | undefined,
  currentState: Projection<Readonly<Record<string, unknown>>>,
): {
  readonly projection: Projection<readonly string[]>;
  readonly diagnostic: PreparationDiagnostic | undefined;
} => {
  if (resourceType !== "clusters" && resourceType !== "pipelines")
    return { projection: { status: "absent" }, diagnostic: undefined };
  if (currentState.status !== "supported")
    return {
      projection: currentState.status === "unsupported" ? currentState : { status: "absent" },
      diagnostic: undefined,
    };
  const state = currentState.value;
  const clusterValues = resourceType === "clusters" ? state : state["clusters"];
  if (resourceType === "pipelines" && !("clusters" in state))
    return { projection: { status: "absent" }, diagnostic: undefined };
  const clusters = resourceType === "clusters" ? [clusterValues] : clusterValues;
  if (!Array.isArray(clusters) || clusters.some((cluster) => !isUnknownRecord(cluster))) {
    const diagnostic: PreparationDiagnostic = {
      resourceKey,
      capability: "instance-pool-reference",
      reason: "invalid-shape",
    };
    return { projection: { status: "unsupported", diagnostic }, diagnostic };
  }
  const references: string[] = [];
  for (const cluster of clusters) {
    for (const field of ["instance_pool_id", "driver_instance_pool_id"]) {
      const reference = getUnknownProp(cluster, field);
      if (reference === undefined) continue;
      if (typeof reference !== "string") {
        const diagnostic: PreparationDiagnostic = {
          resourceKey,
          capability: "instance-pool-reference",
          reason: "invalid-shape",
        };
        return { projection: { status: "unsupported", diagnostic }, diagnostic };
      }
      references.push(reference);
    }
  }
  return { projection: { status: "supported", value: references }, diagnostic: undefined };
};

const prepareWarehouseId = (
  resourceKey: string,
  resourceType: string | undefined,
  currentState: Projection<Readonly<Record<string, unknown>>>,
): {
  readonly projection: Projection<string>;
  readonly diagnostic: PreparationDiagnostic | undefined;
} => {
  if (resourceType === undefined || !WAREHOUSE_SOURCE_TYPES.has(resourceType)) {
    return { projection: { status: "absent" }, diagnostic: undefined };
  }
  if (currentState.status === "unsupported") {
    return {
      projection: { status: "unsupported", diagnostic: currentState.diagnostic },
      diagnostic: undefined,
    };
  }
  if (currentState.status === "absent" || !("warehouse_id" in currentState.value)) {
    return { projection: { status: "absent" }, diagnostic: undefined };
  }
  const value = currentState.value["warehouse_id"];
  if (typeof value === "string") {
    return { projection: { status: "supported", value }, diagnostic: undefined };
  }
  const diagnostic: PreparationDiagnostic = {
    resourceKey,
    capability: "warehouse-reference",
    reason: "invalid-shape",
  };
  return { projection: { status: "unsupported", diagnostic }, diagnostic };
};

/** Prepare only normalized resource records and semantic slices consumed by graphs. */
export const preparePlan = (normalized: NormalizedPlan): PreparedPlan => {
  const byResourceKey = new Map<string, PreparedResource>();
  const diagnostics: PreparationDiagnostic[] = [];
  for (const [resourceKey, entry] of Object.entries(normalized.entries)) {
    const current = prepareCurrentState(resourceKey, entry);
    if (current.diagnostic !== undefined) diagnostics.push(current.diagnostic);
    const resourceType = extractResourceType(resourceKey);
    const warehouse = prepareWarehouseId(resourceKey, resourceType, current.projection);
    if (warehouse.diagnostic !== undefined) diagnostics.push(warehouse.diagnostic);
    const instancePools = prepareInstancePoolReferences(
      resourceKey,
      resourceType,
      current.projection,
    );
    if (instancePools.diagnostic !== undefined) diagnostics.push(instancePools.diagnostic);
    const serving =
      resourceType === "model_serving_endpoints"
        ? prepareServingEndpoint(
            resourceKey,
            current.projection.status === "supported" ? current.projection.value : undefined,
          )
        : { names: { status: "absent" } as const, diagnostic: undefined };
    if (serving.diagnostic !== undefined) diagnostics.push(serving.diagnostic);
    const appResources =
      resourceType === "apps"
        ? prepareAppResources(
            resourceKey,
            current.projection.status === "supported" ? current.projection.value : undefined,
          )
        : { projection: { status: "absent" } as const };
    if (appResources.diagnostic !== undefined) diagnostics.push(appResources.diagnostic);
    const job = resourceType === "jobs" ? prepareJob(resourceKey, entry) : undefined;
    if (job !== undefined) diagnostics.push(...job.diagnostics);
    const references = prepareResourceReferences(resourceKey, entry);
    diagnostics.push(...references.diagnostics);
    byResourceKey.set(resourceKey, {
      currentState: current.projection,
      servedEntityNames: serving.names,
      job: job === undefined ? { status: "absent" } : { status: "supported", value: job.job },
      warehouseId: warehouse.projection,
      instancePoolReferences: instancePools.projection,
      appResources: appResources.projection,
      sourceTableFullName: references.sourceTableFullName,
      qualityMonitorTableName: references.qualityMonitorTableName,
      pipelineIngestionSchemas: references.pipelineIngestionSchemas,
      pipelineEventLog: references.pipelineEventLog,
      pipelineOutputId: references.pipelineOutputId,
      existingPipelineId: references.existingPipelineId,
      syncedTableId: references.syncedTableId,
      postgres: references.postgres,
    });
  }
  return { normalized, byResourceKey, diagnostics };
};
