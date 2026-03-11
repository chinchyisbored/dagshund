import { buildGraphEdge, type GraphEdge } from "../types/graph-types.ts";
import type { PlanEntry } from "../types/plan-schema.ts";
import { DATABASE_INSTANCE_SOURCE_TYPES, extractResourceType } from "../utils/resource-key.ts";
import { getUnknownProp, isUnknownRecord } from "../utils/unknown-record.ts";
import {
  extractResourceState,
  extractSourceTableFullName,
  extractStateField,
  parseThreePartName,
} from "./extract-resource-state.ts";

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
  | { readonly kind: "experiment"; readonly id: string };

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
      edges.push(buildGraphEdge(sourceNodeId, targetId, "unchanged", "lateral::"));
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

/** model_serving_endpoint → registered_model (name-to-key + nested traversal). */
const SERVING_ENDPOINT_MODEL_SPEC: LateralEdgeSpec = {
  sourceTypes: new Set(["model_serving_endpoints"]),
  extractTargetIds: (entry, context) => {
    const state = extractResourceState(entry);
    if (state === undefined) return [];
    const entities = getUnknownProp(state["config"], "served_entities");
    if (!Array.isArray(entities)) return [];
    const targets: string[] = [];
    for (const entity of entities) {
      const name = getUnknownProp(entity, "entity_name");
      if (typeof name !== "string") continue;
      const id = context.nodeIdByResourceKey.get(`resources.registered_models.${name}`);
      if (id !== undefined) targets.push(id);
    }
    return targets;
  },
};

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

/** Factory: alert → sql_warehouse (API-ID resolution via pre-built reverse index). */
const createWarehouseSpec = (warehouseIndex: ReadonlyMap<string, string>): LateralEdgeSpec => ({
  sourceTypes: new Set(["alerts"]),
  extractTargetIds: (entry, context) => {
    if (warehouseIndex.size === 0) return [];
    const apiId = extractStateField(entry, "warehouse_id");
    if (apiId === undefined) return [];
    const targetKey = warehouseIndex.get(apiId);
    if (targetKey === undefined) return [];
    const targetNodeId = context.nodeIdByResourceKey.get(targetKey) ?? targetKey;
    return context.nodeIds.has(targetNodeId) ? [targetNodeId] : [];
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
  SERVING_ENDPOINT_MODEL_SPEC,
  PIPELINE_TARGET_SPEC,
];

/** Extract all lateral (cross-reference) edges from plan entries. */
export const extractLateralEdges = (context: LateralEdgeContext): readonly GraphEdge[] => {
  const warehouseIndex = buildApiIdIndex(context.entries, "sql_warehouses", (e) =>
    extractStateField(e, "id"),
  );
  const allSpecs = [
    ...LATERAL_EDGE_SPECS,
    createWarehouseSpec(warehouseIndex),
    createAppResourcesSpec(context, warehouseIndex),
  ];
  return allSpecs.flatMap((spec) => applyLateralEdgeSpec(spec, context));
};
