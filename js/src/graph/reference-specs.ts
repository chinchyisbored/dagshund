import type { PlanEntry } from "../types/plan-schema.ts";
import type { PreparedPlan, PreparedResource } from "../types/prepared-plan.ts";
import type { PhantomPlacement, ReferenceIdentityCatalog } from "../types/reference-resolution.ts";
import {
  buildPrefixedNodeId,
  extractPhantomResourceType,
  extractResourceType,
  type PhantomKind,
  WAREHOUSE_SOURCE_TYPES,
} from "../utils/resource-key.ts";
import { isUnknownRecord } from "../utils/unknown-record.ts";
import { extractHistoricalStateField, extractResourceState } from "./extract-resource-state.ts";
import { extractBundleResourceIdRef } from "./postgres-paths.ts";

export type LateralEdgeContext = {
  readonly preparedPlan?: PreparedPlan;
  readonly identityCatalog?: ReferenceIdentityCatalog;
  readonly entries: readonly (readonly [string, PlanEntry])[];
  readonly nodeIdByResourceKey: ReadonlyMap<string, string>;
  readonly nodeIds: ReadonlySet<string>;
  readonly servedEntityNames?: ReadonlyMap<string, readonly string[]>;
  readonly schemaNodeIdByIdentity?: ReadonlyMap<string, string>;
  readonly sourceTableNodeIdByIdentity?: ReadonlyMap<string, string>;
  readonly sourceTableResourceKeyByIdentity?: ReadonlyMap<string, string>;
};

export type ReferenceIndexes = {
  readonly warehouseIndex: ReadonlyMap<string, string>;
  readonly dashboardIndex: ReadonlyMap<string, string>;
  readonly alertIndex: ReadonlyMap<string, string>;
  readonly pipelineIndex: ReadonlyMap<string, string>;
  readonly genieSpaceIndex: ReadonlyMap<string, string>;
  readonly jobIndex: ReadonlyMap<string, string>;
  readonly experimentIndex: ReadonlyMap<string, string>;
  readonly registeredModelFullNameIndex: ReadonlyMap<string, string>;
  readonly jobIdMap: ReadonlyMap<number, string>;
};

/** Build a reverse index mapping API ID to resource key for a given resource type. */
export const buildApiIdIndex = (
  entries: readonly (readonly [string, PlanEntry])[],
  resourceType: string,
  extractId: (entry: PlanEntry) => string | undefined,
): ReadonlyMap<string, string> => {
  const pairs: [string, string][] = [];
  for (const [key, entry] of entries) {
    if (extractResourceType(key) !== resourceType) continue;
    const apiId = extractId(entry);
    if (apiId !== undefined) pairs.push([apiId, key]);
  }
  return new Map(pairs);
};

/** Extract job API ID from a job entry's state, handling both number and string job_id. */
export const extractJobApiId = (entry: PlanEntry): string | undefined => {
  const state = extractResourceState(entry);
  const remoteState = isUnknownRecord(entry.remote_state) ? entry.remote_state : undefined;
  const newId = state?.["job_id"];
  const historicalId = remoteState?.["job_id"];
  const id = typeof newId === "string" || typeof newId === "number" ? newId : historicalId;
  return typeof id === "number" ? String(id) : typeof id === "string" ? id : undefined;
};

/** Extract Genie space API ID from state. Created resources may expose either field shape. */
export const extractGenieSpaceApiId = (entry: PlanEntry): string | undefined =>
  extractHistoricalStateField(entry, "space_id") ?? extractHistoricalStateField(entry, "id");

/** Resolve a synced-table pipeline reference to a real key or the standard pipeline phantom ID. */
export const resolvePipelineReference = (
  reference: string,
  pipelineIndex: ReadonlyMap<string, string>,
  existingResourceKeys: ReadonlySet<string>,
): string => {
  const symbolicResourceKey = extractBundleResourceIdRef(reference);
  if (symbolicResourceKey !== undefined) {
    return extractResourceType(symbolicResourceKey) === "pipelines" &&
      existingResourceKeys.has(symbolicResourceKey)
      ? symbolicResourceKey
      : buildPrefixedNodeId("pipeline", reference);
  }
  const indexedTarget = pipelineIndex.get(reference);
  return indexedTarget !== undefined && existingResourceKeys.has(indexedTarget)
    ? indexedTarget
    : buildPrefixedNodeId("pipeline", reference);
};

export type { AppResourceRef } from "../preparation/prepare-app.ts";

export type ConventionalExtraction =
  | { readonly kind: "absent" }
  | {
      readonly kind: "unsupported";
      readonly diagnostic: { readonly capability: string; readonly reason: string };
    }
  | { readonly kind: "supported"; readonly value: string };

export type ConventionalReferenceSpec = {
  readonly sourceTypes: ReadonlySet<string>;
  readonly extract: (resource: PreparedResource | undefined) => ConventionalExtraction;
  readonly targetResourceType: string;
  readonly selectIndex: (indexes: ReferenceIndexes) => ReadonlyMap<string, string>;
  readonly phantomKind: PhantomKind;
  readonly phantomPlacement: PhantomPlacement;
  readonly phantomPolicy: boolean;
  readonly direction: "entry-to-target" | "target-to-entry";
};

const WAREHOUSE_TASK_REFERENCE = {
  selectIndex: (indexes: ReferenceIndexes) => indexes.warehouseIndex,
  targetResourceType: "sql_warehouses",
  phantomKind: "sqlWarehouse" as const,
};

export const CONVENTIONAL_REFERENCE_SPECS = {
  warehouse: {
    sourceTypes: WAREHOUSE_SOURCE_TYPES,
    extract: (resource) => {
      if (resource === undefined || resource.warehouseId.status === "absent")
        return { kind: "absent" };
      if (resource.warehouseId.status === "unsupported") {
        return {
          kind: "unsupported",
          diagnostic: {
            capability: resource.warehouseId.diagnostic.capability,
            reason: resource.warehouseId.diagnostic.reason,
          },
        };
      }
      return { kind: "supported", value: resource.warehouseId.value };
    },
    targetResourceType: WAREHOUSE_TASK_REFERENCE.targetResourceType,
    selectIndex: WAREHOUSE_TASK_REFERENCE.selectIndex,
    phantomKind: WAREHOUSE_TASK_REFERENCE.phantomKind,
    phantomPlacement: {
      kind: "workspace-resource",
      resourceType:
        extractPhantomResourceType(buildPrefixedNodeId("sqlWarehouse", "")) ?? "sql_warehouses",
    },
    phantomPolicy: true,
    direction: "entry-to-target",
  },
} as const satisfies Readonly<Record<string, ConventionalReferenceSpec>>;
export type TaskRefSpec = {
  readonly referenceName: "warehouse_id" | "alert_id" | "dashboard_id" | "pipeline_id";
  readonly selectIndex: (indexes: ReferenceIndexes) => ReadonlyMap<string, string>;
  readonly targetResourceType: string;
  readonly phantomKind: PhantomKind;
};

export const TASK_REF_SPECS: readonly TaskRefSpec[] = [
  {
    referenceName: "warehouse_id",
    ...WAREHOUSE_TASK_REFERENCE,
  },
  {
    referenceName: "alert_id",
    selectIndex: (indexes) => indexes.alertIndex,
    targetResourceType: "alerts",
    phantomKind: "alert",
  },
  {
    referenceName: "dashboard_id",
    selectIndex: (indexes) => indexes.dashboardIndex,
    targetResourceType: "dashboards",
    phantomKind: "dashboard",
  },
  {
    referenceName: "pipeline_id",
    selectIndex: (indexes) => indexes.pipelineIndex,
    targetResourceType: "pipelines",
    phantomKind: "pipeline",
  },
];

/** Resolve a task reference through a bundle interpolation, API-ID index, or phantom ID. */
export const resolveTaskRefTargetKey = (
  refId: string,
  spec: TaskRefSpec,
  indexes: ReferenceIndexes,
): string => {
  const resourceRef = extractBundleResourceIdRef(refId);
  if (resourceRef !== undefined && extractResourceType(resourceRef) === spec.targetResourceType) {
    return resourceRef;
  }
  return spec.selectIndex(indexes).get(refId) ?? buildPrefixedNodeId(spec.phantomKind, refId);
};
