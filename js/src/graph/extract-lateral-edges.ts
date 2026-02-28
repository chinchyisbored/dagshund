import type { GraphEdge } from "../types/graph-types.ts";
import type { PlanEntry } from "../types/plan-schema.ts";
import { DATABASE_INSTANCE_SOURCE_TYPES, extractResourceType } from "../utils/resource-key.ts";
import {
  extractResourceState,
  extractSourceTableFullName,
  extractStateField,
  parseThreePartName,
} from "./build-resource-graph.ts";

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

/** Build an edge with diffState "unchanged" (lateral edges are structural, not diff-related). */
const buildLateralEdge = (source: string, target: string): GraphEdge => ({
  id: `lateral::${source}→${target}`,
  source,
  target,
  label: undefined,
  diffState: "unchanged",
});

/** Build a reverse index mapping warehouse API ID → resource key by scanning sql_warehouses entries. */
const buildWarehouseApiIdIndex = (
  entries: readonly (readonly [string, PlanEntry])[],
): ReadonlyMap<string, string> => {
  const pairs: [string, string][] = [];
  for (const [key, entry] of entries) {
    if (extractResourceType(key) !== "sql_warehouses") continue;
    const apiId = extractStateField(entry, "id");
    if (apiId !== undefined) pairs.push([apiId, key]);
  }
  return new Map(pairs);
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
const runLateralEdgeSpec = (
  spec: LateralEdgeSpec,
  context: LateralEdgeContext,
): readonly GraphEdge[] => {
  const edges: GraphEdge[] = [];
  const seen = new Set<string>();
  for (const [key, entry] of context.entries) {
    const rt = extractResourceType(key);
    if (rt === undefined || !spec.sourceTypes.has(rt)) continue;
    const sourceNodeId = context.nodeIdByResourceKey.get(key) ?? key;
    if (!context.nodeIds.has(sourceNodeId)) continue;
    for (const targetId of spec.extractTargetIds(entry, context)) {
      const pair = `${sourceNodeId}→${targetId}`;
      if (seen.has(pair)) continue;
      seen.add(pair);
      edges.push(buildLateralEdge(sourceNodeId, targetId));
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
  extractTargetIds: (entry, ctx) => {
    const name = extractStateField(entry, "database_instance_name");
    if (name === undefined) return [];
    const id = ctx.nodeIdByResourceKey.get(`resources.database_instances.${name}`);
    return id !== undefined ? [id] : [];
  },
};

/** synced_database_table → source-table phantom (three-part name resolution). */
const SOURCE_TABLE_SPEC: LateralEdgeSpec = {
  sourceTypes: new Set(["synced_database_tables"]),
  extractTargetIds: (entry, ctx) => {
    const name = extractSourceTableFullName(entry);
    if (name === undefined || parseThreePartName(name) === undefined) return [];
    const id = `source-table::${name}`;
    return ctx.nodeIds.has(id) ? [id] : [];
  },
};

/** model_serving_endpoint → registered_model (name-to-key + nested traversal). */
const SERVING_ENDPOINT_MODEL_SPEC: LateralEdgeSpec = {
  sourceTypes: new Set(["model_serving_endpoints"]),
  extractTargetIds: (entry, ctx) => {
    const state = extractResourceState(entry);
    if (state === undefined) return [];
    const config = state["config"];
    if (typeof config !== "object" || config === null) return [];
    // as: navigating into untyped nested JSON — typeof guard above ensures non-null object
    const entities = (config as Readonly<Record<string, unknown>>)["served_entities"];
    if (!Array.isArray(entities)) return [];
    const targets: string[] = [];
    for (const entity of entities) {
      if (typeof entity !== "object" || entity === null) continue;
      const name = (entity as Readonly<Record<string, unknown>>)["entity_name"];
      if (typeof name !== "string") continue;
      const id = ctx.nodeIdByResourceKey.get(`resources.registered_models.${name}`);
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
  const ingestion = state["ingestion_definition"];
  if (typeof ingestion !== "object" || ingestion === null) return [];
  // as: navigating into untyped nested JSON — typeof guard above ensures non-null object
  const objects = (ingestion as Readonly<Record<string, unknown>>)["objects"];
  if (!Array.isArray(objects)) return [];
  const targets: string[] = [];
  for (const obj of objects) {
    if (typeof obj !== "object" || obj === null) continue;
    const objRecord = obj as Readonly<Record<string, unknown>>;
    const schemaDef = objRecord["schema"];
    if (typeof schemaDef !== "object" || schemaDef === null) continue;
    // as: navigating into untyped nested JSON — typeof guard above ensures non-null object
    const sCatalog = (schemaDef as Readonly<Record<string, unknown>>)["source_catalog"];
    const sSchema = (schemaDef as Readonly<Record<string, unknown>>)["source_schema"];
    if (typeof sCatalog === "string" && typeof sSchema === "string") {
      const schemaId = `schema::${sCatalog}.${sSchema}`;
      if (nodeIds.has(schemaId)) targets.push(schemaId);
    }
  }
  return targets;
};

/** pipeline → catalog/schema (hierarchy-ID resolution). */
const PIPELINE_TARGET_SPEC: LateralEdgeSpec = {
  sourceTypes: new Set(["pipelines"]),
  extractTargetIds: (entry, ctx) => [
    ...collectPipelineCatalogTargets(entry, ctx.nodeIds),
    ...collectPipelineIngestionTargets(entry, ctx.nodeIds),
  ],
};

/** Factory: alert → sql_warehouse (API-ID resolution via pre-built reverse index). */
const createWarehouseSpec = (context: LateralEdgeContext): LateralEdgeSpec => {
  const warehouseIndex = buildWarehouseApiIdIndex(context.entries);
  return {
    sourceTypes: new Set(["alerts"]),
    extractTargetIds: (entry, ctx) => {
      if (warehouseIndex.size === 0) return [];
      const apiId = extractStateField(entry, "warehouse_id");
      if (apiId === undefined) return [];
      const targetKey = warehouseIndex.get(apiId);
      if (targetKey === undefined) return [];
      const targetNodeId = ctx.nodeIdByResourceKey.get(targetKey) ?? targetKey;
      return ctx.nodeIds.has(targetNodeId) ? [targetNodeId] : [];
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
  const allSpecs = [...LATERAL_EDGE_SPECS, createWarehouseSpec(context)];
  return allSpecs.flatMap((spec) => runLateralEdgeSpec(spec, context));
};
