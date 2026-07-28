import type { PlanEntry } from "../types/plan-schema.ts";
import {
  buildPrefixedNodeId,
  buildResourceKey,
  extractResourceType,
  type PhantomKind,
  TASK_WAREHOUSE_KEYS,
} from "../utils/resource-key.ts";
import { isUnknownRecord } from "../utils/unknown-record.ts";
import {
  extractResourceState,
  extractStateField,
  parseThreePartName,
} from "./extract-resource-state.ts";
import { extractBundleResourceIdRef } from "./postgres-paths.ts";

export type LateralEdgeContext = {
  readonly entries: readonly (readonly [string, PlanEntry])[];
  readonly nodeIdByResourceKey: ReadonlyMap<string, string>;
  readonly nodeIds: ReadonlySet<string>;
};

export type ReferenceIndexes = {
  readonly warehouseIndex: ReadonlyMap<string, string>;
  readonly dashboardIndex: ReadonlyMap<string, string>;
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
  const v = state?.["job_id"];
  return typeof v === "number" ? String(v) : typeof v === "string" ? v : undefined;
};

/** Extract Genie space API ID from state. Created resources may expose either field shape. */
export const extractGenieSpaceApiId = (entry: PlanEntry): string | undefined =>
  extractStateField(entry, "space_id") ?? extractStateField(entry, "id");

export type AppResourceRef =
  | { readonly kind: "job"; readonly id: string }
  | { readonly kind: "sql_warehouse"; readonly id: string }
  | { readonly kind: "genie_space"; readonly id: string; readonly name: string }
  | { readonly kind: "secret_scope"; readonly name: string }
  | { readonly kind: "serving_endpoint"; readonly name: string }
  | { readonly kind: "experiment"; readonly id: string }
  | { readonly kind: "uc_securable"; readonly fullName: string };

/** Extract typed resource references from an app entry's nested resources[] array. */
export const extractAppResourceReferences = (entry: PlanEntry): readonly AppResourceRef[] => {
  const state = extractResourceState(entry);
  if (state === undefined) return [];
  const resources = state["resources"];
  if (!Array.isArray(resources)) return [];
  const refs: AppResourceRef[] = [];
  for (const resource of resources) {
    if (!isUnknownRecord(resource)) continue;
    const job = resource["job"];
    if (isUnknownRecord(job) && typeof job["id"] === "string") {
      refs.push({ kind: "job", id: job["id"] });
      continue;
    }
    const warehouse = resource["sql_warehouse"];
    if (isUnknownRecord(warehouse) && typeof warehouse["id"] === "string") {
      refs.push({ kind: "sql_warehouse", id: warehouse["id"] });
      continue;
    }
    const genieSpace = resource["genie_space"];
    if (
      isUnknownRecord(genieSpace) &&
      typeof genieSpace["space_id"] === "string" &&
      typeof genieSpace["name"] === "string"
    ) {
      refs.push({ kind: "genie_space", id: genieSpace["space_id"], name: genieSpace["name"] });
      continue;
    }
    const secret = resource["secret"];
    if (isUnknownRecord(secret) && typeof secret["scope"] === "string") {
      refs.push({ kind: "secret_scope", name: secret["scope"] });
      continue;
    }
    const endpoint = resource["serving_endpoint"];
    if (isUnknownRecord(endpoint) && typeof endpoint["name"] === "string") {
      refs.push({ kind: "serving_endpoint", name: endpoint["name"] });
      continue;
    }
    const experiment = resource["experiment"];
    if (isUnknownRecord(experiment) && typeof experiment["experiment_id"] === "string") {
      refs.push({ kind: "experiment", id: experiment["experiment_id"] });
      continue;
    }
    const ucSecurable = resource["uc_securable"];
    if (isUnknownRecord(ucSecurable) && typeof ucSecurable["securable_full_name"] === "string") {
      refs.push({ kind: "uc_securable", fullName: ucSecurable["securable_full_name"] });
    }
  }
  return refs;
};

/** Extract warehouse_id from a task's typed sub-object (sql_task, dashboard_task, etc.). */
export const extractTaskWarehouseId = (
  task: Readonly<Record<string, unknown>>,
): string | undefined => {
  for (const key of TASK_WAREHOUSE_KEYS) {
    const sub = task[key];
    if (!isUnknownRecord(sub)) continue;
    const warehouseId = sub["warehouse_id"];
    if (typeof warehouseId === "string") return warehouseId;
  }
  return undefined;
};

/** Extract dashboard_id from a task's dashboard_task sub-object. */
export const extractTaskDashboardId = (
  task: Readonly<Record<string, unknown>>,
): string | undefined => {
  const sub = task["dashboard_task"];
  if (!isUnknownRecord(sub)) return undefined;
  const dashboardId = sub["dashboard_id"];
  return typeof dashboardId === "string" ? dashboardId : undefined;
};

/** Extract pipeline_id from a task's pipeline_task sub-object. */
export const extractTaskPipelineId = (
  task: Readonly<Record<string, unknown>>,
): string | undefined => {
  const sub = task["pipeline_task"];
  if (!isUnknownRecord(sub)) return undefined;
  const pipelineId = sub["pipeline_id"];
  return typeof pipelineId === "string" ? pipelineId : undefined;
};

export type TaskRefSpec = {
  readonly extractId: (task: Readonly<Record<string, unknown>>) => string | undefined;
  readonly selectIndex: (indexes: ReferenceIndexes) => ReadonlyMap<string, string>;
  readonly targetResourceType: string;
  readonly phantomKind: PhantomKind;
};

export const TASK_REF_SPECS: readonly TaskRefSpec[] = [
  {
    extractId: extractTaskWarehouseId,
    selectIndex: (indexes) => indexes.warehouseIndex,
    targetResourceType: "sql_warehouses",
    phantomKind: "sqlWarehouse",
  },
  {
    extractId: extractTaskDashboardId,
    selectIndex: (indexes) => indexes.dashboardIndex,
    targetResourceType: "dashboards",
    phantomKind: "dashboard",
  },
  {
    extractId: extractTaskPipelineId,
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

const genieSpaceResourceKey = (name: string): string => buildResourceKey("genie_spaces", name);
const secretScopeResourceKey = (name: string): string => buildResourceKey("secret_scopes", name);
const servingEndpointResourceKey = (name: string): string =>
  buildResourceKey("model_serving_endpoints", name);

const resolveGenieSpaceTargetKey = (
  ref: Extract<AppResourceRef, { readonly kind: "genie_space" }>,
  context: LateralEdgeContext,
  indexes: ReferenceIndexes,
): string => {
  const resourceRef = extractBundleResourceIdRef(ref.id);
  if (resourceRef !== undefined && extractResourceType(resourceRef) === "genie_spaces") {
    return resourceRef;
  }
  const nameKey = genieSpaceResourceKey(ref.name);
  return context.nodeIdByResourceKey.has(nameKey)
    ? nameKey
    : (indexes.genieSpaceIndex.get(ref.id) ?? nameKey);
};

export const resolveAppRefTargetKey = (
  ref: AppResourceRef,
  indexes: ReferenceIndexes,
  context: LateralEdgeContext,
): string | undefined => {
  switch (ref.kind) {
    case "job":
      return indexes.jobIndex.get(ref.id) ?? buildPrefixedNodeId("job", ref.id);
    case "sql_warehouse":
      return indexes.warehouseIndex.get(ref.id) ?? buildPrefixedNodeId("sqlWarehouse", ref.id);
    case "genie_space":
      return resolveGenieSpaceTargetKey(ref, context, indexes);
    case "experiment":
      return indexes.experimentIndex.get(ref.id) ?? buildPrefixedNodeId("experiment", ref.id);
    case "secret_scope":
      return secretScopeResourceKey(ref.name);
    case "serving_endpoint":
      return servingEndpointResourceKey(ref.name);
    case "uc_securable":
      return parseThreePartName(ref.fullName) !== undefined
        ? buildPrefixedNodeId("sourceTable", ref.fullName)
        : undefined;
  }
  const exhaustive: never = ref;
  return exhaustive;
};

export type PhantomReference = {
  readonly id: string;
  readonly label: string;
  readonly resourceKey: string;
};

/** Resolve a single app resource reference to a phantom entry, or undefined if the target exists. */
export const resolveAppPhantomRef = (
  ref: AppResourceRef,
  existingResourceKeys: ReadonlySet<string>,
  indexes: ReferenceIndexes,
): PhantomReference | undefined => {
  switch (ref.kind) {
    case "secret_scope": {
      const rk = secretScopeResourceKey(ref.name);
      return existingResourceKeys.has(rk)
        ? undefined
        : { id: buildPrefixedNodeId("secretScope", ref.name), resourceKey: rk, label: ref.name };
    }
    case "serving_endpoint": {
      const rk = servingEndpointResourceKey(ref.name);
      return existingResourceKeys.has(rk)
        ? undefined
        : {
            id: buildPrefixedNodeId("servingEndpoint", ref.name),
            resourceKey: rk,
            label: ref.name,
          };
    }
    case "job": {
      if (indexes.jobIndex.has(ref.id)) return undefined;
      const id = buildPrefixedNodeId("job", ref.id);
      return { id, resourceKey: id, label: ref.id };
    }
    case "sql_warehouse": {
      if (indexes.warehouseIndex.has(ref.id)) return undefined;
      const id = buildPrefixedNodeId("sqlWarehouse", ref.id);
      return { id, resourceKey: id, label: ref.id };
    }
    case "genie_space": {
      const resourceRef = extractBundleResourceIdRef(ref.id);
      if (resourceRef !== undefined) return undefined;
      const rk = genieSpaceResourceKey(ref.name);
      if (existingResourceKeys.has(rk)) return undefined;
      if (indexes.genieSpaceIndex.has(ref.id)) return undefined;
      const id = buildPrefixedNodeId("genieSpace", ref.name);
      return { id, resourceKey: rk, label: ref.name };
    }
    case "experiment": {
      if (indexes.experimentIndex.has(ref.id)) return undefined;
      const id = buildPrefixedNodeId("experiment", ref.id);
      return { id, resourceKey: id, label: ref.id };
    }
    case "uc_securable":
      // Handled via externalLeafPhantomRefs in buildResourceGraph: placed in UC hierarchy, not workspace.
      return undefined;
  }
  const exhaustive: never = ref;
  return exhaustive;
};
