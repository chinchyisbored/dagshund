import { buildGraphEdge, type GraphEdge } from "../types/graph-types.ts";
import type { PlanEntry } from "../types/plan-schema.ts";
import {
  buildPrefixedNodeId,
  buildResourceKey,
  DATABASE_INSTANCE_SOURCE_TYPES,
  extractResourceType,
  LATERAL_EDGE_PREFIX,
  WAREHOUSE_SOURCE_TYPES,
} from "../utils/resource-key.ts";
import { getUnknownProp, isUnknownRecord } from "../utils/unknown-record.ts";
import {
  buildDerivedNodeId,
  DERIVED_SOURCE_TYPES,
  entryOwnsPromotedPhantomIdentity,
  extractDerivedNodeRefs,
  resolvePromotedPhantomNodeId,
} from "./derived-node-specs.ts";
import {
  extractResourceState,
  extractServedEntities,
  extractSourceTableFullName,
  extractStateField,
  parseThreePartName,
} from "./extract-resource-state.ts";
import { resolveTaskEntries } from "./extract-tasks.ts";
import {
  resolvePostgresBranchRefIdentity,
  resolvePostgresBranchRefIdentityFromEntries,
  resolvePostgresBranchResourceKey,
  resolvePostgresDatabaseResourceKey,
  resolvePostgresRoleResourceKey,
} from "./postgres-paths.ts";
import {
  extractAppResourceReferences,
  type LateralEdgeContext,
  type ReferenceIndexes,
  resolveAppRefTargetKey,
  resolveTaskRefTargetKey,
  TASK_REF_SPECS,
} from "./reference-specs.ts";
import { resolveRunJobTarget } from "./resolve-run-job-target.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const resolveExistingTargetId = (
  targetKey: string,
  context: LateralEdgeContext,
): string | undefined => {
  const targetNodeId = context.nodeIdByResourceKey.get(targetKey) ?? targetKey;
  return context.nodeIds.has(targetNodeId) ? targetNodeId : undefined;
};

// ---------------------------------------------------------------------------
// Declarative lateral edge specs
// ---------------------------------------------------------------------------

/** A declarative spec: given a plan entry and context, return 0+ target node IDs. */
type LateralEdgeSpec = {
  readonly sourceTypes: ReadonlySet<string>;
  readonly direction?: "entry-to-target" | "target-to-entry";
  readonly extractTargetIds: (
    entry: PlanEntry,
    context: LateralEdgeContext,
    resourceKey: string,
  ) => readonly string[];
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
    for (const targetId of spec.extractTargetIds(entry, context, key)) {
      const edgeSource = spec.direction === "target-to-entry" ? targetId : sourceNodeId;
      const edgeTarget = spec.direction === "target-to-entry" ? sourceNodeId : targetId;
      const pair = `${edgeSource}→${edgeTarget}`;
      if (seen.has(pair)) continue;
      seen.add(pair);
      edges.push(buildGraphEdge(edgeSource, edgeTarget, "unchanged", LATERAL_EDGE_PREFIX));
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
    const id = resolveExistingTargetId(buildResourceKey("database_instances", name), context);
    return id !== undefined ? [id] : [];
  },
};

/** synced tables → source-table phantom (three-part name resolution). */
const SOURCE_TABLE_SPEC: LateralEdgeSpec = {
  sourceTypes: new Set(["postgres_synced_tables", "synced_database_tables"]),
  extractTargetIds: (entry, context, resourceKey) => {
    const name = extractSourceTableFullName(entry);
    if (name === undefined || parseThreePartName(name) === undefined) return [];
    if (entryOwnsPromotedPhantomIdentity(resourceKey, entry, "sourceTable", name)) return [];
    const targetId = resolvePromotedPhantomNodeId("sourceTable", name, context.nodeIds);
    return targetId !== undefined ? [targetId] : [];
  },
};

/** Derived outputs depend on their owning managed resources. */
const DERIVED_OUTPUT_SPEC: LateralEdgeSpec = {
  sourceTypes: DERIVED_SOURCE_TYPES,
  direction: "target-to-entry",
  extractTargetIds: (entry, context, resourceKey) =>
    extractDerivedNodeRefs(resourceKey, entry).flatMap((ref) => {
      const targetId = buildDerivedNodeId(ref.derivedKind, ref.identity);
      return context.nodeIds.has(targetId) ? [targetId] : [];
    }),
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
        registeredModelFullNameIndex.get(name) ?? buildResourceKey("registered_models", name);
      const targetNodeId = resolveExistingTargetId(targetKey, context);
      if (targetNodeId !== undefined) {
        targets.push(targetNodeId);
      } else {
        const phantomId = buildPrefixedNodeId("registeredModel", name);
        if (context.nodeIds.has(phantomId)) targets.push(phantomId);
      }
    }
    return targets;
  },
});

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
      const schemaId = buildPrefixedNodeId("schema", `${sourceCatalog}.${sourceSchema}`);
      if (nodeIds.has(schemaId)) targets.push(schemaId);
    }
  }
  return targets;
};

/** pipeline → ingestion source schema.
 *  Direct catalog/target fields intentionally have no edge because they only
 *  define output placement, not a concrete resource dependency. */
const PIPELINE_INGESTION_SOURCE_SPEC: LateralEdgeSpec = {
  sourceTypes: new Set(["pipelines"]),
  extractTargetIds: (entry, context) => collectPipelineIngestionTargets(entry, context.nodeIds),
};

/** quality_monitor → source-table phantom (via three-part table_name resolution).
 *  output_schema_name intentionally has no edge because it is only placement
 *  for generated monitoring tables, not the concrete table being monitored. */
const QUALITY_MONITOR_TABLE_SPEC: LateralEdgeSpec = {
  sourceTypes: new Set(["quality_monitors"]),
  extractTargetIds: (entry, context) => {
    const tableName = extractStateField(entry, "table_name");
    if (tableName === undefined || parseThreePartName(tableName) === undefined) return [];
    const targetId = resolvePromotedPhantomNodeId("sourceTable", tableName, context.nodeIds);
    return targetId !== undefined ? [targetId] : [];
  },
};

const resolvePostgresBranchTargetIds = (
  branchRef: string,
  context: LateralEdgeContext,
): readonly string[] => {
  const targetKey = resolvePostgresBranchResourceKey(branchRef, context.entries);
  if (targetKey !== undefined) {
    const targetNodeId = resolveExistingTargetId(targetKey, context);
    return targetNodeId !== undefined ? [targetNodeId] : [];
  }

  const targetIdentity = resolvePostgresBranchRefIdentity(branchRef);
  if (targetIdentity === undefined) return [];
  const phantomId = buildPrefixedNodeId("postgresBranch", targetIdentity);
  return context.nodeIds.has(phantomId) ? [phantomId] : [];
};

const resolvePostgresRoleTargetIds = (
  roleRef: string,
  context: LateralEdgeContext,
): readonly string[] => {
  const targetKey = resolvePostgresRoleResourceKey(roleRef, context.entries);
  if (targetKey !== undefined) {
    const targetNodeId = resolveExistingTargetId(targetKey, context);
    return targetNodeId !== undefined ? [targetNodeId] : [];
  }

  return [];
};

const resolvePostgresDatabaseTargetIds = (
  entry: PlanEntry,
  context: LateralEdgeContext,
): readonly string[] => {
  const branch = extractStateField(entry, "branch");
  const postgresDatabase = extractStateField(entry, "postgres_database");
  if (branch === undefined || postgresDatabase === undefined) return [];

  const targetKey = resolvePostgresDatabaseResourceKey(branch, postgresDatabase, context.entries);
  if (targetKey !== undefined) {
    const targetNodeId = resolveExistingTargetId(targetKey, context);
    return targetNodeId !== undefined ? [targetNodeId] : [];
  }

  const branchIdentity = resolvePostgresBranchRefIdentityFromEntries(branch, context.entries);
  if (branchIdentity === undefined) return [];
  const targetId = buildPrefixedNodeId("postgresDatabase", `${branchIdentity}/${postgresDatabase}`);
  return context.nodeIds.has(targetId) ? [targetId] : [];
};

/** postgres_catalog → postgres_database via branch + database fields. */
const POSTGRES_DATABASE_TARGET_SPEC: LateralEdgeSpec = {
  sourceTypes: new Set(["postgres_catalogs"]),
  extractTargetIds: (entry, context) => {
    return resolvePostgresDatabaseTargetIds(entry, context);
  },
};

/** postgres_branch → source postgres_branch via semantic source_branch lineage. */
const POSTGRES_BRANCH_SOURCE_SPEC: LateralEdgeSpec = {
  sourceTypes: new Set(["postgres_branches"]),
  extractTargetIds: (entry, context) => {
    const sourceBranch = extractStateField(entry, "source_branch");
    if (sourceBranch === undefined) return [];
    return resolvePostgresBranchTargetIds(sourceBranch, context);
  },
};

/** postgres_database → postgres_role via semantic owner role field.
 *  postgres_roles.membership_roles intentionally has no edge: CLI 1.14 only
 *  permits the fixed DATABRICKS_SUPERUSER role, not another bundle role. */
const POSTGRES_DATABASE_ROLE_SPEC: LateralEdgeSpec = {
  sourceTypes: new Set(["postgres_databases"]),
  extractTargetIds: (entry, context) => {
    const role = extractStateField(entry, "role");
    if (role === undefined) return [];
    return resolvePostgresRoleTargetIds(role, context);
  },
};

/** Factory: alert/dashboard/quality_monitor → sql_warehouse (API-ID resolution via pre-built reverse index). */
const createWarehouseSpec = (warehouseIndex: ReadonlyMap<string, string>): LateralEdgeSpec => ({
  sourceTypes: WAREHOUSE_SOURCE_TYPES,
  extractTargetIds: (entry, context) => {
    const apiId = extractStateField(entry, "warehouse_id");
    if (apiId === undefined) return [];
    const targetKey = warehouseIndex.get(apiId) ?? buildPrefixedNodeId("sqlWarehouse", apiId);
    const targetNodeId = resolveExistingTargetId(targetKey, context);
    return targetNodeId !== undefined ? [targetNodeId] : [];
  },
});

/** Factory: job → sql_warehouse/dashboard/pipeline (via task sub-object references). */
const createJobTaskRefsSpec = (indexes: ReferenceIndexes): LateralEdgeSpec => ({
  sourceTypes: new Set(["jobs"]),
  extractTargetIds: (entry, context) => {
    const tasks = resolveTaskEntries(entry.new_state, entry.remote_state);
    if (tasks.length === 0) return [];
    const targets: string[] = [];
    const seen = new Set<string>();
    for (const task of tasks) {
      for (const spec of TASK_REF_SPECS) {
        const id = spec.extractId(task);
        if (id === undefined || seen.has(id)) continue;
        seen.add(id);
        const targetKey = resolveTaskRefTargetKey(id, spec, indexes);
        const targetNodeId = resolveExistingTargetId(targetKey, context);
        if (targetNodeId !== undefined) targets.push(targetNodeId);
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
        resolvedKey ??
        (typeof runJobId === "number" ? buildPrefixedNodeId("job", String(runJobId)) : undefined);
      if (targetKey === undefined) continue;
      const targetNodeId = resolveExistingTargetId(targetKey, context);
      if (targetNodeId === undefined) continue;
      if (seen.has(targetNodeId)) continue;
      seen.add(targetNodeId);
      targets.push(targetNodeId);
    }
    return targets;
  },
});

/** Factory: app → job/warehouse/secret/serving_endpoint/experiment (via nested resources[] array). */
const createAppResourcesSpec = (indexes: ReferenceIndexes): LateralEdgeSpec => ({
  sourceTypes: new Set(["apps"]),
  extractTargetIds: (entry, context) => {
    const refs = extractAppResourceReferences(entry);
    const targets: string[] = [];
    for (const ref of refs) {
      const targetKey = resolveAppRefTargetKey(ref, indexes, context);
      if (targetKey === undefined) continue;
      const targetNodeId = resolveExistingTargetId(targetKey, context);
      if (targetNodeId !== undefined) targets.push(targetNodeId);
    }
    return targets;
  },
});

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

const LATERAL_EDGE_SPECS: readonly LateralEdgeSpec[] = [
  DATABASE_INSTANCE_SPEC,
  SOURCE_TABLE_SPEC,
  DERIVED_OUTPUT_SPEC,
  PIPELINE_INGESTION_SOURCE_SPEC,
  QUALITY_MONITOR_TABLE_SPEC,
  POSTGRES_DATABASE_TARGET_SPEC,
  POSTGRES_BRANCH_SOURCE_SPEC,
  POSTGRES_DATABASE_ROLE_SPEC,
];

/** Extract all lateral (cross-reference) edges from plan entries. */
export const extractLateralEdges = (
  context: LateralEdgeContext,
  indexes: ReferenceIndexes,
): readonly GraphEdge[] => {
  const { warehouseIndex, registeredModelFullNameIndex, jobIdMap } = indexes;
  const allSpecs = [
    ...LATERAL_EDGE_SPECS,
    createWarehouseSpec(warehouseIndex),
    createJobTaskRefsSpec(indexes),
    createJobRunJobTaskSpec(jobIdMap),
    createAppResourcesSpec(indexes),
    createServingEndpointModelSpec(registeredModelFullNameIndex),
  ];
  return allSpecs.flatMap((spec) => applyLateralEdgeSpec(spec, context));
};
