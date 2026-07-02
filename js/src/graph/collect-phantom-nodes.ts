import {
  buildEdge,
  buildHierarchyGraphNode,
  filterDefinedEdges,
  type GraphEdge,
  type PhantomGraphNode,
} from "../types/graph-types.ts";
import type { PlanEntry } from "../types/plan-schema.ts";
import {
  buildPrefixedNodeId,
  buildResourceKey,
  DATABASE_INSTANCE_SOURCE_TYPES,
  extractResourceType,
  WAREHOUSE_SOURCE_TYPES,
} from "../utils/resource-key.ts";
import { extractStateField } from "./extract-resource-state.ts";
import { resolveTaskEntries } from "./extract-tasks.ts";
import {
  extractAppResourceReferences,
  type ReferenceIndexes,
  resolveAppPhantomRef,
  TASK_REF_SPECS,
} from "./reference-specs.ts";

type PhantomEntry = { readonly id: string; readonly label: string; readonly resourceKey: string };

/** Convert a deduped phantom entry map into graph nodes + parent edges. */
const buildPhantomNodesFromEntries = (
  phantoms: ReadonlyMap<string, PhantomEntry>,
  parentId: string,
): { readonly nodes: readonly PhantomGraphNode[]; readonly edges: readonly GraphEdge[] } => {
  if (phantoms.size === 0) return { nodes: [], edges: [] };
  const nodes: PhantomGraphNode[] = [...phantoms.values()].map(({ id, label, resourceKey }) =>
    buildHierarchyGraphNode("phantom", id, label, resourceKey),
  );
  const edges = filterDefinedEdges(nodes.map((node) => buildEdge(parentId, node.id)));
  return { nodes, edges };
};

// ---------------------------------------------------------------------------
// Phantom database instances
// ---------------------------------------------------------------------------

/** Collect phantom nodes for database instances referenced by entries but absent from the plan.
 *  Uses the database-instance phantom node ID convention. */
export const collectPhantomDatabaseInstances = (
  entries: readonly (readonly [string, PlanEntry])[],
  existingResourceKeys: ReadonlySet<string>,
  parentId: string,
): { readonly nodes: readonly PhantomGraphNode[]; readonly edges: readonly GraphEdge[] } => {
  const phantoms = new Map<string, PhantomEntry>();
  for (const [resourceKey, entry] of entries) {
    const resourceType = extractResourceType(resourceKey);
    if (resourceType === undefined || !DATABASE_INSTANCE_SOURCE_TYPES.has(resourceType)) continue;
    const name = extractStateField(entry, "database_instance_name");
    if (name === undefined) continue;
    // resourceKey uses dot-path form (not the :: prefixed id)
    // so nodeIdByResourceKey can resolve it from lateral edge specs.
    const rk = buildResourceKey("database_instances", name);
    if (!existingResourceKeys.has(rk)) {
      const id = buildPrefixedNodeId("databaseInstance", name);
      phantoms.set(id, { id, resourceKey: rk, label: name });
    }
  }
  return buildPhantomNodesFromEntries(phantoms, parentId);
};

// ---------------------------------------------------------------------------
// Phantom app dependencies
// ---------------------------------------------------------------------------

/** Collect phantom nodes for app resource references absent from the plan. */
export const collectPhantomAppDependencies = (
  entries: readonly (readonly [string, PlanEntry])[],
  existingResourceKeys: ReadonlySet<string>,
  parentId: string,
  indexes: ReferenceIndexes,
): { readonly nodes: readonly PhantomGraphNode[]; readonly edges: readonly GraphEdge[] } => {
  const phantoms = new Map<string, PhantomEntry>();
  for (const [key, entry] of entries) {
    if (extractResourceType(key) !== "apps") continue;
    for (const ref of extractAppResourceReferences(entry)) {
      const phantom = resolveAppPhantomRef(ref, existingResourceKeys, indexes);
      if (phantom !== undefined) phantoms.set(phantom.id, phantom);
    }
  }
  return buildPhantomNodesFromEntries(phantoms, parentId);
};

// ---------------------------------------------------------------------------
// Phantom warehouses and dashboards (from alerts, dashboards, quality monitors, job tasks)
// ---------------------------------------------------------------------------

/** Collect phantom nodes from top-level warehouse references and job task sub-objects
 *  (warehouses, dashboards, pipelines, cross-job run_job_task). */
export const collectPhantomExternalRefs = (
  entries: readonly (readonly [string, PlanEntry])[],
  parentId: string,
  indexes: ReferenceIndexes,
): { readonly nodes: readonly PhantomGraphNode[]; readonly edges: readonly GraphEdge[] } => {
  const { warehouseIndex, jobIdMap } = indexes;
  const phantoms = new Map<string, PhantomEntry>();

  for (const [key, entry] of entries) {
    const resourceType = extractResourceType(key);
    if (resourceType === undefined) continue;

    // Top-level resources with warehouse_id (alerts, dashboards, quality_monitors)
    if (WAREHOUSE_SOURCE_TYPES.has(resourceType)) {
      const warehouseId = extractStateField(entry, "warehouse_id");
      if (warehouseId !== undefined && !warehouseIndex.has(warehouseId)) {
        const id = buildPrefixedNodeId("sqlWarehouse", warehouseId);
        phantoms.set(id, { id, resourceKey: id, label: warehouseId });
      }
    }

    // Job tasks with warehouse_id, dashboard_id, pipeline_id, and run_job_task.job_id
    if (resourceType === "jobs") {
      const tasks = resolveTaskEntries(entry.new_state, entry.remote_state);
      for (const task of tasks) {
        for (const spec of TASK_REF_SPECS) {
          const refId = spec.extractId(task);
          if (refId !== undefined && !spec.selectIndex(indexes).has(refId)) {
            const id = buildPrefixedNodeId(spec.phantomKind, refId);
            phantoms.set(id, { id, resourceKey: id, label: refId });
          }
        }
        const runJobId = task.run_job_task?.job_id;
        if (typeof runJobId === "number" && runJobId !== 0 && !jobIdMap.has(runJobId)) {
          const id = buildPrefixedNodeId("job", String(runJobId));
          phantoms.set(id, { id, resourceKey: id, label: String(runJobId) });
        }
      }
    }
  }

  return buildPhantomNodesFromEntries(phantoms, parentId);
};
