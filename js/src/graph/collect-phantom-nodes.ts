import {
  buildEdge,
  filterDefinedEdges,
  type GraphEdge,
  type PhantomGraphNode,
} from "../types/graph-types.ts";
import type { PlanEntry } from "../types/plan-schema.ts";
import { DATABASE_INSTANCE_SOURCE_TYPES, extractResourceType } from "../utils/resource-key.ts";
import {
  type AppResourceRef,
  buildApiIdIndex,
  extractAppResourceReferences,
  extractJobApiId,
} from "./extract-lateral-edges.ts";
import { extractStateField } from "./extract-resource-state.ts";

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
  const phantomNames = new Set<string>();
  for (const [resourceKey, entry] of entries) {
    const resourceType = extractResourceType(resourceKey);
    if (resourceType === undefined || !DATABASE_INSTANCE_SOURCE_TYPES.has(resourceType)) continue;
    const name = extractStateField(entry, "database_instance_name");
    if (name === undefined) continue;
    const key = `resources.database_instances.${name}`;
    if (!existingResourceKeys.has(key)) phantomNames.add(name);
  }
  if (phantomNames.size === 0) return { nodes: [], edges: [] };
  // Inline construction: resourceKey uses dot-path form (not the :: prefixed id)
  // so nodeIdByResourceKey can resolve it from lateral edge specs.
  const nodes: PhantomGraphNode[] = [...phantomNames].map((name) => ({
    id: `database-instance::${name}`,
    label: name,
    nodeKind: "phantom",
    diffState: "unchanged",
    resourceKey: `resources.database_instances.${name}`,
    changes: undefined,
    resourceState: undefined,
  }));
  const edges = filterDefinedEdges(nodes.map((node) => buildEdge(parentId, node.id)));
  return { nodes, edges };
};

// ---------------------------------------------------------------------------
// Phantom app dependencies
// ---------------------------------------------------------------------------

type PhantomEntry = { readonly id: string; readonly label: string; readonly resourceKey: string };

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
  }
};

/** Collect phantom nodes for app resource references absent from the plan. */
export const collectPhantomAppDependencies = (
  entries: readonly (readonly [string, PlanEntry])[],
  existingResourceKeys: ReadonlySet<string>,
  parentId: string,
): { readonly nodes: readonly PhantomGraphNode[]; readonly edges: readonly GraphEdge[] } => {
  const jobIndex = buildApiIdIndex(entries, "jobs", extractJobApiId);
  const warehouseIndex = buildApiIdIndex(entries, "sql_warehouses", (e) =>
    extractStateField(e, "id"),
  );
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
