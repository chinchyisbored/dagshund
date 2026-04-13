import {
  buildEdge,
  filterDefinedEdges,
  type GraphEdge,
  type PhantomGraphNode,
} from "../types/graph-types.ts";
import type { PlanEntry } from "../types/plan-schema.ts";
import {
  DATABASE_INSTANCE_SOURCE_TYPES,
  extractResourceType,
  WAREHOUSE_SOURCE_TYPES,
} from "../utils/resource-key.ts";
import {
  type AppResourceRef,
  buildApiIdIndex,
  extractAppResourceReferences,
  extractJobApiId,
  extractTaskDashboardId,
  extractTaskPipelineId,
  extractTaskWarehouseId,
} from "./extract-lateral-edges.ts";
import { extractStateField } from "./extract-resource-state.ts";
import { resolveTaskEntries } from "./extract-tasks.ts";

type PhantomEntry = { readonly id: string; readonly label: string; readonly resourceKey: string };

/** Convert a deduped phantom entry map into graph nodes + parent edges. */
const buildPhantomNodesFromEntries = (
  phantoms: ReadonlyMap<string, PhantomEntry>,
  parentId: string,
): { readonly nodes: readonly PhantomGraphNode[]; readonly edges: readonly GraphEdge[] } => {
  if (phantoms.size === 0) return { nodes: [], edges: [] };
  const nodes: PhantomGraphNode[] = [...phantoms.values()].map(({ id, label, resourceKey }) => ({
    id,
    label,
    nodeKind: "phantom",
    diffState: "unchanged",
    resourceKey,
    changes: undefined,
    resourceState: undefined,
  }));
  const edges = filterDefinedEdges(nodes.map((node) => buildEdge(parentId, node.id)));
  return { nodes, edges };
};

// ---------------------------------------------------------------------------
// Phantom database instances
// ---------------------------------------------------------------------------

/** Collect phantom nodes for database instances referenced by entries but absent from the plan.
 *  Uses `database-instance::` prefix following the phantom node ID convention. */
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
    const rk = `resources.database_instances.${name}`;
    if (!existingResourceKeys.has(rk)) {
      const id = `database-instance::${name}`;
      phantoms.set(id, { id, resourceKey: rk, label: name });
    }
  }
  return buildPhantomNodesFromEntries(phantoms, parentId);
};

// ---------------------------------------------------------------------------
// Phantom app dependencies
// ---------------------------------------------------------------------------

/** Resolve a single app resource reference to a phantom entry, or undefined if the target exists. */
const resolveAppPhantomRef = (
  ref: AppResourceRef,
  existingResourceKeys: ReadonlySet<string>,
  jobIndex: ReadonlyMap<string, string>,
  warehouseIndex: ReadonlyMap<string, string>,
  experimentIndex: ReadonlyMap<string, string>,
): PhantomEntry | undefined => {
  switch (ref.kind) {
    case "secret_scope": {
      const rk = `resources.secret_scopes.${ref.name}`;
      return existingResourceKeys.has(rk)
        ? undefined
        : { id: `secret-scope::${ref.name}`, resourceKey: rk, label: ref.name };
    }
    case "serving_endpoint": {
      const rk = `resources.model_serving_endpoints.${ref.name}`;
      return existingResourceKeys.has(rk)
        ? undefined
        : { id: `serving-endpoint::${ref.name}`, resourceKey: rk, label: ref.name };
    }
    case "job": {
      if (jobIndex.has(ref.id)) return undefined;
      const id = `job::${ref.id}`;
      return { id, resourceKey: id, label: ref.id };
    }
    case "sql_warehouse": {
      if (warehouseIndex.has(ref.id)) return undefined;
      const id = `sql-warehouse::${ref.id}`;
      return { id, resourceKey: id, label: ref.id };
    }
    case "experiment": {
      if (experimentIndex.has(ref.id)) return undefined;
      const id = `experiment::${ref.id}`;
      return { id, resourceKey: id, label: ref.id };
    }
    case "uc_securable":
      // Handled via externalLeafPhantomRefs in buildResourceGraph — placed in UC hierarchy, not workspace.
      return undefined;
  }
};

/** Collect phantom nodes for app resource references absent from the plan. */
export const collectPhantomAppDependencies = (
  entries: readonly (readonly [string, PlanEntry])[],
  existingResourceKeys: ReadonlySet<string>,
  parentId: string,
  warehouseIndex: ReadonlyMap<string, string>,
): { readonly nodes: readonly PhantomGraphNode[]; readonly edges: readonly GraphEdge[] } => {
  const jobIndex = buildApiIdIndex(entries, "jobs", extractJobApiId);
  const experimentIndex = buildApiIdIndex(entries, "experiments", (e) =>
    extractStateField(e, "experiment_id"),
  );

  const phantoms = new Map<string, PhantomEntry>();
  for (const [key, entry] of entries) {
    if (extractResourceType(key) !== "apps") continue;
    for (const ref of extractAppResourceReferences(entry)) {
      const phantom = resolveAppPhantomRef(
        ref,
        existingResourceKeys,
        jobIndex,
        warehouseIndex,
        experimentIndex,
      );
      if (phantom !== undefined) phantoms.set(phantom.id, phantom);
    }
  }
  return buildPhantomNodesFromEntries(phantoms, parentId);
};

// ---------------------------------------------------------------------------
// Phantom warehouses and dashboards (from alerts, dashboards, quality monitors, job tasks)
// ---------------------------------------------------------------------------

/** Collect phantom nodes from top-level warehouse references and job task sub-objects
 *  (warehouses, dashboards, pipelines). */
export const collectPhantomExternalRefs = (
  entries: readonly (readonly [string, PlanEntry])[],
  parentId: string,
  warehouseIndex: ReadonlyMap<string, string>,
  dashboardIndex: ReadonlyMap<string, string>,
  pipelineIndex: ReadonlyMap<string, string>,
): { readonly nodes: readonly PhantomGraphNode[]; readonly edges: readonly GraphEdge[] } => {
  const phantoms = new Map<string, PhantomEntry>();

  for (const [key, entry] of entries) {
    const resourceType = extractResourceType(key);
    if (resourceType === undefined) continue;

    // Top-level resources with warehouse_id (alerts, dashboards, quality_monitors)
    if (WAREHOUSE_SOURCE_TYPES.has(resourceType)) {
      const warehouseId = extractStateField(entry, "warehouse_id");
      if (warehouseId !== undefined && !warehouseIndex.has(warehouseId)) {
        const id = `sql-warehouse::${warehouseId}`;
        phantoms.set(id, { id, resourceKey: id, label: warehouseId });
      }
    }

    // Job tasks with warehouse_id, dashboard_id, and pipeline_id
    if (resourceType === "jobs") {
      const tasks = resolveTaskEntries(entry.new_state, entry.remote_state);
      for (const task of tasks) {
        const warehouseId = extractTaskWarehouseId(task);
        if (warehouseId !== undefined && !warehouseIndex.has(warehouseId)) {
          const id = `sql-warehouse::${warehouseId}`;
          phantoms.set(id, { id, resourceKey: id, label: warehouseId });
        }
        const dashboardId = extractTaskDashboardId(task);
        if (dashboardId !== undefined && !dashboardIndex.has(dashboardId)) {
          const id = `dashboard::${dashboardId}`;
          phantoms.set(id, { id, resourceKey: id, label: dashboardId });
        }
        const pipelineId = extractTaskPipelineId(task);
        if (pipelineId !== undefined && !pipelineIndex.has(pipelineId)) {
          const id = `pipeline::${pipelineId}`;
          phantoms.set(id, { id, resourceKey: id, label: pipelineId });
        }
      }
    }
  }

  return buildPhantomNodesFromEntries(phantoms, parentId);
};
