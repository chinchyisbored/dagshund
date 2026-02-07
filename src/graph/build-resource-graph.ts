import { mapActionToDiffState } from "../parser/map-diff-state.ts";
import type { GraphEdge, GraphNode, PlanGraph } from "../types/graph-types.ts";
import type { Plan, PlanEntry } from "../types/plan-schema.ts";
import { extractResourceName } from "../utils/resource-key.ts";

/** Unity Catalog resource types that live under the UC → catalog → schema hierarchy. */
const UC_TYPES: ReadonlySet<string> = new Set([
  "catalogs",
  "schemas",
  "volumes",
  "registered_models",
]);

/** Extract the resource type segment from a plan key like "resources.schemas.analytics". */
export const extractResourceType = (key: string): string | undefined =>
  key.split(".")[1];

/** Check whether a plan key represents a job entry. */
export const isJobEntry = (key: string): boolean =>
  key.startsWith("resources.jobs.");

/** Check whether a resource type belongs under Unity Catalog. */
export const isUnityCatalogType = (resourceType: string): boolean =>
  UC_TYPES.has(resourceType);

/**
 * Safely extract a named field from a plan entry's state.
 * Checks new_state.value first (for live resources), then remote_state (for deleted resources).
 */
export const extractStateField = (entry: PlanEntry, field: string): string | undefined => {
  const newState = entry.new_state;
  if (typeof newState === "object" && newState !== null && "value" in newState) {
    const value = (newState as { readonly value: unknown }).value;
    if (typeof value === "object" && value !== null && field in value) {
      const fieldValue = (value as Record<string, unknown>)[field];
      if (typeof fieldValue === "string") return fieldValue;
    }
  }

  const remoteState = entry.remote_state;
  if (typeof remoteState === "object" && remoteState !== null && field in remoteState) {
    const fieldValue = (remoteState as Record<string, unknown>)[field];
    if (typeof fieldValue === "string") return fieldValue;
  }

  return undefined;
};

/** Extract the flat state object from a plan entry (new_state.value or remote_state). */
const extractResourceState = (entry: PlanEntry): Readonly<Record<string, unknown>> | undefined => {
  const newState = entry.new_state;
  if (typeof newState === "object" && newState !== null && "value" in newState) {
    const value = (newState as { readonly value: unknown }).value;
    if (typeof value === "object" && value !== null) {
      return value as Readonly<Record<string, unknown>>;
    }
  }

  const remoteState = entry.remote_state;
  if (typeof remoteState === "object" && remoteState !== null) {
    return remoteState as Readonly<Record<string, unknown>>;
  }

  return undefined;
};

/** Build a GraphNode for a real plan resource entry. */
const buildResourceNode = (key: string, entry: PlanEntry): GraphNode => ({
  id: key,
  label: extractResourceName(key),
  nodeKind: "resource",
  diffState: mapActionToDiffState(entry.action),
  resourceKey: key,
  taskKey: undefined,
  changes: entry.changes,
  resourceState: extractResourceState(entry),
  taskChangeSummary: undefined,
  external: false,
});

/** Build a virtual container node (UC root, catalog, workspace root). */
const buildGroupNode = (id: string, label: string, external = false): GraphNode => ({
  id,
  label,
  nodeKind: "resource-group",
  diffState: "unchanged",
  resourceKey: id,
  taskKey: undefined,
  changes: undefined,
  resourceState: undefined,
  taskChangeSummary: undefined,
  external,
});

/** Build a unique edge, returning undefined if source === target. */
const buildEdge = (source: string, target: string): GraphEdge | undefined =>
  source === target
    ? undefined
    : {
        id: `${source}→${target}`,
        source,
        target,
        label: undefined,
        diffState: "unchanged",
      };

/** Build the complete resource graph for non-job plan entries. */
export const buildResourceGraph = (plan: Plan): PlanGraph => {
  const entries = Object.entries(plan.plan ?? {}).filter(([key]) => !isJobEntry(key));

  if (entries.length === 0) {
    return { nodes: [], edges: [] };
  }

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const edgeIds = new Set<string>();

  const addEdge = (edge: GraphEdge | undefined): void => {
    if (edge !== undefined && !edgeIds.has(edge.id)) {
      edgeIds.add(edge.id);
      edges.push(edge);
    }
  };

  // Classify entries
  const ucEntries: (readonly [string, PlanEntry])[] = [];
  const workspaceEntries: (readonly [string, PlanEntry])[] = [];

  for (const [key, entry] of entries) {
    const resourceType = extractResourceType(key);
    if (resourceType !== undefined && isUnityCatalogType(resourceType)) {
      ucEntries.push([key, entry]);
    } else {
      workspaceEntries.push([key, entry]);
    }
  }

  // Build a lookup from schema name → schema plan key (for linking volumes/models to schemas)
  const schemaNameToKey = new Map<string, string>();
  for (const [key, entry] of ucEntries) {
    const resourceType = extractResourceType(key);
    if (resourceType === "schemas") {
      const name = extractStateField(entry, "name");
      const catalog = extractStateField(entry, "catalog_name");
      if (name !== undefined && catalog !== undefined) {
        schemaNameToKey.set(`${catalog}.${name}`, key);
      }
    }
  }

  // UC hierarchy
  if (ucEntries.length > 0) {
    const ucRoot = buildGroupNode("uc-root", "Unity Catalog");
    nodes.push(ucRoot);

    // Collect unique catalogs
    const catalogs = new Set<string>();
    for (const [, entry] of ucEntries) {
      const catalog = extractStateField(entry, "catalog_name");
      if (catalog !== undefined) catalogs.add(catalog);
    }

    for (const catalog of catalogs) {
      const catalogId = `catalog::${catalog}`;
      nodes.push(buildGroupNode(catalogId, catalog));
      addEdge(buildEdge("uc-root", catalogId));
    }

    // Track phantom schema nodes to avoid duplicates
    const createdPhantoms = new Set<string>();

    for (const [key, entry] of ucEntries) {
      const resourceType = extractResourceType(key);
      const catalog = extractStateField(entry, "catalog_name");
      const catalogId = catalog !== undefined ? `catalog::${catalog}` : "uc-root";
      const node = buildResourceNode(key, entry);
      nodes.push(node);

      if (resourceType === "schemas" || resourceType === "catalogs") {
        // Schemas and catalogs link directly to their catalog node
        addEdge(buildEdge(catalogId, key));
      } else {
        // Volumes and models: try to link to their schema
        const schemaName = extractStateField(entry, "schema_name");
        const schemaKey =
          schemaName !== undefined && catalog !== undefined
            ? schemaNameToKey.get(`${catalog}.${schemaName}`)
            : undefined;

        if (schemaKey !== undefined) {
          addEdge(buildEdge(schemaKey, key));
        } else if (schemaName !== undefined && catalog !== undefined) {
          // Create a phantom node for an external (non-DABs-managed) schema
          const phantomId = `external::${catalog}.${schemaName}`;
          if (!createdPhantoms.has(phantomId)) {
            createdPhantoms.add(phantomId);
            nodes.push(buildGroupNode(phantomId, schemaName, true));
            addEdge(buildEdge(catalogId, phantomId));
          }
          addEdge(buildEdge(phantomId, key));
        } else {
          addEdge(buildEdge(catalogId, key));
        }
      }
    }
  }

  // Workspace hierarchy
  if (workspaceEntries.length > 0) {
    const workspaceRoot = buildGroupNode("workspace-root", "Workspace");
    nodes.push(workspaceRoot);

    for (const [key, entry] of workspaceEntries) {
      nodes.push(buildResourceNode(key, entry));
      addEdge(buildEdge("workspace-root", key));
    }
  }

  // Honor explicit depends_on edges from plan entries
  for (const [key, entry] of entries) {
    if (entry.depends_on !== undefined) {
      for (const dep of entry.depends_on) {
        // dep.node is the plan key of the dependency
        addEdge(buildEdge(dep.node, key));
      }
    }
  }

  return { nodes, edges };
};

/** Check whether a plan has any non-job resource entries. */
export const hasNonJobResources = (plan: Plan): boolean =>
  Object.keys(plan.plan ?? {}).some((key) => !isJobEntry(key));
