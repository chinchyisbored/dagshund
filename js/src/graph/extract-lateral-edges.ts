import type { GraphEdge } from "../types/graph-types.ts";
import type { PlanEntry } from "../types/plan-schema.ts";
import { extractResourceType } from "../utils/resource-key.ts";
import { extractResourceState, extractStateField } from "./build-resource-graph.ts";

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

/** Build a reverse index mapping warehouse API ID → node ID by scanning sql_warehouses entries. */
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
// Per-category extractors
// ---------------------------------------------------------------------------

/** synced_database_table → database_instance, database_catalog → database_instance (name-to-key). */
const extractDatabaseInstanceEdges = (context: LateralEdgeContext): readonly GraphEdge[] => {
  const edges: GraphEdge[] = [];
  for (const [key, entry] of context.entries) {
    const rt = extractResourceType(key);
    if (rt !== "synced_database_tables" && rt !== "database_catalogs") continue;
    const instanceName = extractStateField(entry, "database_instance_name");
    if (instanceName === undefined) continue;
    const targetKey = `resources.database_instances.${instanceName}`;
    const targetNodeId = context.nodeIdByResourceKey.get(targetKey);
    if (targetNodeId === undefined) continue;
    const sourceNodeId = context.nodeIdByResourceKey.get(key) ?? key;
    if (!context.nodeIds.has(sourceNodeId)) continue;
    edges.push(buildLateralEdge(sourceNodeId, targetNodeId));
  }
  return edges;
};

/** alert → sql_warehouse (API-ID resolution). */
const extractWarehouseEdges = (context: LateralEdgeContext): readonly GraphEdge[] => {
  const warehouseIndex = buildWarehouseApiIdIndex(context.entries);
  if (warehouseIndex.size === 0) return [];

  const edges: GraphEdge[] = [];
  for (const [key, entry] of context.entries) {
    if (extractResourceType(key) !== "alerts") continue;
    const warehouseId = extractStateField(entry, "warehouse_id");
    if (warehouseId === undefined) continue;
    const targetNodeId = warehouseIndex.get(warehouseId);
    if (targetNodeId === undefined) continue;
    const sourceNodeId = context.nodeIdByResourceKey.get(key) ?? key;
    if (!context.nodeIds.has(sourceNodeId) || !context.nodeIds.has(targetNodeId)) continue;
    edges.push(buildLateralEdge(sourceNodeId, targetNodeId));
  }
  return edges;
};

/** model_serving_endpoint → registered_model (name-to-key + nested traversal). */
const extractServingEndpointModelEdges = (context: LateralEdgeContext): readonly GraphEdge[] => {
  const edges: GraphEdge[] = [];
  for (const [key, entry] of context.entries) {
    if (extractResourceType(key) !== "model_serving_endpoints") continue;
    const state = extractResourceState(entry);
    if (state === undefined) continue;
    const config = state["config"];
    if (typeof config !== "object" || config === null) continue;
    // as: navigating into untyped nested JSON — typeof guard above ensures non-null object
    const servedEntities = (config as Readonly<Record<string, unknown>>)["served_entities"];
    if (!Array.isArray(servedEntities)) continue;
    const sourceNodeId = context.nodeIdByResourceKey.get(key) ?? key;
    if (!context.nodeIds.has(sourceNodeId)) continue;
    for (const entity of servedEntities) {
      if (typeof entity !== "object" || entity === null) continue;
      const entityName = (entity as Readonly<Record<string, unknown>>)["entity_name"];
      if (typeof entityName !== "string") continue;
      const targetKey = `resources.registered_models.${entityName}`;
      const targetNodeId = context.nodeIdByResourceKey.get(targetKey);
      if (targetNodeId === undefined) continue;
      edges.push(buildLateralEdge(sourceNodeId, targetNodeId));
    }
  }
  return edges;
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
    const schemaId = `external::${catalogName}.${targetSchemaName}`;
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
      const schemaId = `external::${sCatalog}.${sSchema}`;
      if (nodeIds.has(schemaId)) targets.push(schemaId);
    }
  }
  return targets;
};

/** pipeline → catalog/schema (hierarchy-ID resolution, deduped). */
const extractPipelineTargetEdges = (context: LateralEdgeContext): readonly GraphEdge[] => {
  const edges: GraphEdge[] = [];
  const seen = new Set<string>();
  for (const [key, entry] of context.entries) {
    if (extractResourceType(key) !== "pipelines") continue;
    const sourceNodeId = context.nodeIdByResourceKey.get(key) ?? key;
    if (!context.nodeIds.has(sourceNodeId)) continue;
    const targets = [
      ...collectPipelineCatalogTargets(entry, context.nodeIds),
      ...collectPipelineIngestionTargets(entry, context.nodeIds),
    ];
    for (const target of targets) {
      const pair = `${sourceNodeId}→${target}`;
      if (seen.has(pair)) continue;
      seen.add(pair);
      edges.push(buildLateralEdge(sourceNodeId, target));
    }
  }
  return edges;
};

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/** Extract all lateral (cross-reference) edges from plan entries. */
export const extractLateralEdges = (context: LateralEdgeContext): readonly GraphEdge[] => [
  ...extractDatabaseInstanceEdges(context),
  ...extractWarehouseEdges(context),
  ...extractServingEndpointModelEdges(context),
  ...extractPipelineTargetEdges(context),
];
