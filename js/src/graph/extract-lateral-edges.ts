import { buildGraphEdge, type GraphEdge } from "../types/graph-types.ts";
import type { PlanEntry } from "../types/plan-schema.ts";
import {
  DATABASE_INSTANCE_SOURCE_TYPES,
  extractResourceType,
  LATERAL_EDGE_PREFIX,
  TASK_WAREHOUSE_KEYS,
  WAREHOUSE_SOURCE_TYPES,
} from "../utils/resource-key.ts";
import { getUnknownProp, isUnknownRecord } from "../utils/unknown-record.ts";
import {
  extractResourceState,
  extractServedEntities,
  extractSourceTableFullName,
  extractStateField,
  parseThreePartName,
} from "./extract-resource-state.ts";
import { resolveTaskEntries } from "./extract-tasks.ts";
import { resolveRunJobTarget } from "./resolve-run-job-target.ts";

// ---------------------------------------------------------------------------
// Context type passed to all extractors
// ---------------------------------------------------------------------------

type LateralEdgeContext = {
  readonly entries: readonly (readonly [string, PlanEntry])[];
  readonly nodeIdByResourceKey: ReadonlyMap<string, string>;
  readonly nodeIds: ReadonlySet<string>;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a reverse index mapping API ID → resource key for a given resource type. */
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

// ---------------------------------------------------------------------------
// App resource reference extraction
// ---------------------------------------------------------------------------

export type AppResourceRef =
  | { readonly kind: "job"; readonly id: string }
  | { readonly kind: "sql_warehouse"; readonly id: string }
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
    if (isUnknownRecord(experiment) && typeof experiment["id"] === "string") {
      refs.push({ kind: "experiment", id: experiment["id"] });
      continue;
    }
    const ucSecurable = resource["uc_securable"];
    if (isUnknownRecord(ucSecurable) && typeof ucSecurable["securable_full_name"] === "string") {
      refs.push({ kind: "uc_securable", fullName: ucSecurable["securable_full_name"] });
    }
  }
  return refs;
};

// ---------------------------------------------------------------------------
// Declarative lateral edge specs
// ---------------------------------------------------------------------------

/** A declarative spec: given a plan entry and context, return 0+ target node IDs. */
type LateralEdgeSpec = {
  readonly sourceTypes: ReadonlySet<string>;
  readonly extractTargetIds: (entry: PlanEntry, context: LateralEdgeContext) => readonly string[];
};

/** Execute a lateral edge spec against all entries, with built-in deduplication. */
const applyLateralEdgeSpec = (
  spec: LateralEdgeSpec,
  context: LateralEdgeContext,
): readonly GraphEdge[] => {
  const edges: GraphEdge[] = [];
  const seen = new Set<string>();
  for (const [key, entry] of context.entries) {
    const resourceType = extractResourceType(key);
    if (resourceType === undefined || !spec.sourceTypes.has(resourceType)) continue;
    const sourceNodeId = context.nodeIdByResourceKey.get(key) ?? key;
    if (!context.nodeIds.has(sourceNodeId)) continue;
    for (const targetId of spec.extractTargetIds(entry, context)) {
      const pair = `${sourceNodeId}→${targetId}`;
      if (seen.has(pair)) continue;
      seen.add(pair);
      edges.push(buildGraphEdge(sourceNodeId, targetId, "unchanged", LATERAL_EDGE_PREFIX));
    }
  }
  return edges;
};

// ---------------------------------------------------------------------------
// Specs
// ---------------------------------------------------------------------------

/** synced_database_table → database_instance, database_catalog → database_instance (name-to-key). */
const DATABASE_INSTANCE_SPEC: LateralEdgeSpec = {
  sourceTypes: DATABASE_INSTANCE_SOURCE_TYPES,
  extractTargetIds: (entry, context) => {
    const name = extractStateField(entry, "database_instance_name");
    if (name === undefined) return [];
    const id = context.nodeIdByResourceKey.get(`resources.database_instances.${name}`);
    return id !== undefined ? [id] : [];
  },
};

/** synced_database_table → source-table phantom (three-part name resolution). */
const SOURCE_TABLE_SPEC: LateralEdgeSpec = {
  sourceTypes: new Set(["synced_database_tables"]),
  extractTargetIds: (entry, context) => {
    const name = extractSourceTableFullName(entry);
    if (name === undefined || parseThreePartName(name) === undefined) return [];
    const id = `source-table::${name}`;
    return context.nodeIds.has(id) ? [id] : [];
  },
};

/** Factory: model_serving_endpoint → registered_model (full_name index + phantom fallback). */
const createServingEndpointModelSpec = (
  registeredModelFullNameIndex: ReadonlyMap<string, string>,
): LateralEdgeSpec => ({
  sourceTypes: new Set(["model_serving_endpoints"]),
  extractTargetIds: (entry, context) => {
    const entities = extractServedEntities(entry);
    const targets: string[] = [];
    for (const entity of entities) {
      const name = getUnknownProp(entity, "entity_name");
      if (typeof name !== "string") continue;
      // Resolution chain: full_name index → simple name key → phantom
      const targetKey =
        registeredModelFullNameIndex.get(name) ?? `resources.registered_models.${name}`;
      const targetNodeId = context.nodeIdByResourceKey.get(targetKey) ?? targetKey;
      if (context.nodeIds.has(targetNodeId)) {
        targets.push(targetNodeId);
      } else {
        const phantomId = `registered-model::${name}`;
        if (context.nodeIds.has(phantomId)) targets.push(phantomId);
      }
    }
    return targets;
  },
});

/** Collect catalog/schema target IDs from a pipeline's direct catalog and target fields. */
const collectPipelineCatalogTargets = (
  entry: PlanEntry,
  nodeIds: ReadonlySet<string>,
): readonly string[] => {
  const targets: string[] = [];
  const catalogName = extractStateField(entry, "catalog");
  if (catalogName === undefined) return targets;
  const catalogId = `catalog::${catalogName}`;
  if (nodeIds.has(catalogId)) targets.push(catalogId);
  const targetSchemaName = extractStateField(entry, "target");
  if (targetSchemaName !== undefined) {
    const schemaId = `schema::${catalogName}.${targetSchemaName}`;
    if (nodeIds.has(schemaId)) targets.push(schemaId);
  }
  return targets;
};

/** Collect schema target IDs from a pipeline's ingestion_definition.objects. */
const collectPipelineIngestionTargets = (
  entry: PlanEntry,
  nodeIds: ReadonlySet<string>,
): readonly string[] => {
  const state = extractResourceState(entry);
  if (state === undefined) return [];
  const objects = getUnknownProp(state["ingestion_definition"], "objects");
  if (!Array.isArray(objects)) return [];
  const targets: string[] = [];
  for (const obj of objects) {
    const schemaDef = getUnknownProp(obj, "schema");
    if (!isUnknownRecord(schemaDef)) continue;
    const sourceCatalog = schemaDef["source_catalog"];
    const sourceSchema = schemaDef["source_schema"];
    if (typeof sourceCatalog === "string" && typeof sourceSchema === "string") {
      const schemaId = `schema::${sourceCatalog}.${sourceSchema}`;
      if (nodeIds.has(schemaId)) targets.push(schemaId);
    }
  }
  return targets;
};

/** pipeline → catalog/schema (hierarchy-ID resolution). */
const PIPELINE_TARGET_SPEC: LateralEdgeSpec = {
  sourceTypes: new Set(["pipelines"]),
  extractTargetIds: (entry, context) => [
    ...collectPipelineCatalogTargets(entry, context.nodeIds),
    ...collectPipelineIngestionTargets(entry, context.nodeIds),
  ],
};

/** quality_monitor → source-table phantom (via three-part table_name resolution). */
const QUALITY_MONITOR_TABLE_SPEC: LateralEdgeSpec = {
  sourceTypes: new Set(["quality_monitors"]),
  extractTargetIds: (entry, context) => {
    const tableName = extractStateField(entry, "table_name");
    if (tableName === undefined || parseThreePartName(tableName) === undefined) return [];
    const phantomId = `source-table::${tableName}`;
    return context.nodeIds.has(phantomId) ? [phantomId] : [];
  },
};

/** Factory: alert/dashboard/quality_monitor → sql_warehouse (API-ID resolution via pre-built reverse index). */
const createWarehouseSpec = (warehouseIndex: ReadonlyMap<string, string>): LateralEdgeSpec => ({
  sourceTypes: WAREHOUSE_SOURCE_TYPES,
  extractTargetIds: (entry, context) => {
    const apiId = extractStateField(entry, "warehouse_id");
    if (apiId === undefined) return [];
    const targetKey = warehouseIndex.get(apiId) ?? `sql-warehouse::${apiId}`;
    const targetNodeId = context.nodeIdByResourceKey.get(targetKey) ?? targetKey;
    return context.nodeIds.has(targetNodeId) ? [targetNodeId] : [];
  },
});

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

/** Factory: job → sql_warehouse/dashboard/pipeline (via task sub-object references). */
const createJobTaskRefsSpec = (
  warehouseIndex: ReadonlyMap<string, string>,
  dashboardIndex: ReadonlyMap<string, string>,
  pipelineIndex: ReadonlyMap<string, string>,
): LateralEdgeSpec => ({
  sourceTypes: new Set(["jobs"]),
  extractTargetIds: (entry, context) => {
    const tasks = resolveTaskEntries(entry.new_state, entry.remote_state);
    if (tasks.length === 0) return [];
    const targets: string[] = [];
    const seen = new Set<string>();
    for (const task of tasks) {
      const warehouseId = extractTaskWarehouseId(task);
      if (warehouseId !== undefined && !seen.has(warehouseId)) {
        seen.add(warehouseId);
        const targetKey = warehouseIndex.get(warehouseId) ?? `sql-warehouse::${warehouseId}`;
        const targetNodeId = context.nodeIdByResourceKey.get(targetKey) ?? targetKey;
        if (context.nodeIds.has(targetNodeId)) targets.push(targetNodeId);
      }
      const dashboardId = extractTaskDashboardId(task);
      if (dashboardId !== undefined && !seen.has(dashboardId)) {
        seen.add(dashboardId);
        const targetKey = dashboardIndex.get(dashboardId) ?? `dashboard::${dashboardId}`;
        const targetNodeId = context.nodeIdByResourceKey.get(targetKey) ?? targetKey;
        if (context.nodeIds.has(targetNodeId)) targets.push(targetNodeId);
      }
      const pipelineId = extractTaskPipelineId(task);
      if (pipelineId !== undefined && !seen.has(pipelineId)) {
        seen.add(pipelineId);
        const targetKey = pipelineIndex.get(pipelineId) ?? `pipeline::${pipelineId}`;
        const targetNodeId = context.nodeIdByResourceKey.get(targetKey) ?? targetKey;
        if (context.nodeIds.has(targetNodeId)) targets.push(targetNodeId);
      }
    }
    return targets;
  },
});

/** Factory: job → job (via run_job_task.job_id, with vars-interpolation fallback for first-deploy). */
const createJobRunJobTaskSpec = (jobIdMap: ReadonlyMap<number, string>): LateralEdgeSpec => ({
  sourceTypes: new Set(["jobs"]),
  extractTargetIds: (entry, context) => {
    const tasks = resolveTaskEntries(entry.new_state, entry.remote_state);
    if (tasks.length === 0) return [];
    const targets: string[] = [];
    const seen = new Set<string>();
    for (const task of tasks) {
      const runJobId = task.run_job_task?.job_id;
      if (runJobId === undefined) continue;
      const resolvedKey = resolveRunJobTarget(runJobId, jobIdMap, entry.new_state, task.task_key);
      const targetKey =
        resolvedKey ?? (typeof runJobId === "number" ? `job::${runJobId}` : undefined);
      if (targetKey === undefined) continue;
      const targetNodeId = context.nodeIdByResourceKey.get(targetKey) ?? targetKey;
      if (seen.has(targetNodeId)) continue;
      seen.add(targetNodeId);
      if (context.nodeIds.has(targetNodeId)) targets.push(targetNodeId);
    }
    return targets;
  },
});

/** Factory: app → job/warehouse/secret/serving_endpoint/experiment (via nested resources[] array). */
const createAppResourcesSpec = (
  context: LateralEdgeContext,
  warehouseIndex: ReadonlyMap<string, string>,
): LateralEdgeSpec => {
  const jobIndex = buildApiIdIndex(context.entries, "jobs", extractJobApiId);
  const experimentIndex = buildApiIdIndex(context.entries, "experiments", (e) =>
    extractStateField(e, "experiment_id"),
  );
  return {
    sourceTypes: new Set(["apps"]),
    extractTargetIds: (entry, context) => {
      const refs = extractAppResourceReferences(entry);
      const targets: string[] = [];
      for (const ref of refs) {
        let targetKey: string | undefined;
        switch (ref.kind) {
          case "job":
            targetKey = jobIndex.get(ref.id) ?? `job::${ref.id}`;
            break;
          case "sql_warehouse":
            targetKey = warehouseIndex.get(ref.id) ?? `sql-warehouse::${ref.id}`;
            break;
          case "experiment":
            targetKey = experimentIndex.get(ref.id) ?? `experiment::${ref.id}`;
            break;
          case "secret_scope":
            targetKey = `resources.secret_scopes.${ref.name}`;
            break;
          case "serving_endpoint":
            targetKey = `resources.model_serving_endpoints.${ref.name}`;
            break;
          case "uc_securable":
            targetKey =
              parseThreePartName(ref.fullName) !== undefined
                ? `source-table::${ref.fullName}`
                : undefined;
            break;
        }
        if (targetKey === undefined) continue;
        const targetNodeId = context.nodeIdByResourceKey.get(targetKey) ?? targetKey;
        if (context.nodeIds.has(targetNodeId)) targets.push(targetNodeId);
      }
      return targets;
    },
  };
};

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

const LATERAL_EDGE_SPECS: readonly LateralEdgeSpec[] = [
  DATABASE_INSTANCE_SPEC,
  SOURCE_TABLE_SPEC,
  PIPELINE_TARGET_SPEC,
  QUALITY_MONITOR_TABLE_SPEC,
];

type LateralEdgeIndexes = {
  readonly warehouseIndex: ReadonlyMap<string, string>;
  readonly dashboardIndex: ReadonlyMap<string, string>;
  readonly pipelineIndex: ReadonlyMap<string, string>;
  readonly registeredModelFullNameIndex: ReadonlyMap<string, string>;
  readonly jobIdMap: ReadonlyMap<number, string>;
};

/** Extract all lateral (cross-reference) edges from plan entries. */
export const extractLateralEdges = (
  context: LateralEdgeContext,
  indexes: LateralEdgeIndexes,
): readonly GraphEdge[] => {
  const { warehouseIndex, dashboardIndex, pipelineIndex, registeredModelFullNameIndex, jobIdMap } =
    indexes;
  const allSpecs = [
    ...LATERAL_EDGE_SPECS,
    createWarehouseSpec(warehouseIndex),
    createJobTaskRefsSpec(warehouseIndex, dashboardIndex, pipelineIndex),
    createJobRunJobTaskSpec(jobIdMap),
    createAppResourcesSpec(context, warehouseIndex),
    createServingEndpointModelSpec(registeredModelFullNameIndex),
  ];
  return allSpecs.flatMap((spec) => applyLateralEdgeSpec(spec, context));
};
