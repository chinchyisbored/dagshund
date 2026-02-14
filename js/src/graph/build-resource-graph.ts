import { z } from "zod/v4";
import { mapActionToDiffState } from "../parser/map-diff-state.ts";
import {
  type GraphEdge,
  type PlanGraph,
  type ResourceGraphNode,
  type ResourceGroupGraphNode,
  toEdgeDiffState,
} from "../types/graph-types.ts";
import type { Plan, PlanEntry } from "../types/plan-schema.ts";
import { extractResourceName } from "../utils/resource-key.ts";

/** Schema for new_state: { value: { ...fields } }. */
const newStateSchema = z
  .object({
    value: z.record(z.string(), z.unknown()).readonly().optional(),
  })
  .readonly();

/** Schema for remote_state: { ...fields }. */
const remoteStateSchema = z.record(z.string(), z.unknown()).readonly();

/** Catalog-tier types — direct children of uc-root. */
const CATALOG_TIER_TYPES: ReadonlySet<string> = new Set(["catalogs", "database_catalogs"]);

/** Schema-tier types — nest under catalogs. */
const SCHEMA_TIER_TYPES: ReadonlySet<string> = new Set(["schemas"]);

/** All UC resource types (union of tiers + leaf types). */
const UC_TYPES: ReadonlySet<string> = new Set([
  ...CATALOG_TIER_TYPES,
  ...SCHEMA_TIER_TYPES,
  "volumes",
  "registered_models",
]);

/** Extract the resource type segment from a plan key like "resources.schemas.analytics". */
export const extractResourceType = (key: string): string | undefined => key.split(".")[1];

/** Check whether a plan key represents a job entry. */
export const isJobEntry = (key: string): boolean => key.startsWith("resources.jobs.");

/** Check whether a resource type belongs under Unity Catalog. */
export const isUnityCatalogType = (resourceType: string): boolean => UC_TYPES.has(resourceType);

/**
 * Safely extract a named field from a plan entry's state.
 * Checks new_state.value first (for live resources), then remote_state (for deleted resources).
 */
export const extractStateField = (entry: PlanEntry, field: string): string | undefined => {
  const parsedNew = newStateSchema.safeParse(entry.new_state);
  if (parsedNew.success) {
    const fieldValue = parsedNew.data.value?.[field];
    if (typeof fieldValue === "string") return fieldValue;
  }

  const parsedRemote = remoteStateSchema.safeParse(entry.remote_state);
  if (parsedRemote.success) {
    const fieldValue = parsedRemote.data[field];
    if (typeof fieldValue === "string") return fieldValue;
  }

  return undefined;
};

/** Extract the flat state object from a plan entry (new_state.value or remote_state). */
const extractResourceState = (entry: PlanEntry): Readonly<Record<string, unknown>> | undefined => {
  const parsedNew = newStateSchema.safeParse(entry.new_state);
  if (parsedNew.success && parsedNew.data.value !== undefined) {
    return parsedNew.data.value;
  }

  const parsedRemote = remoteStateSchema.safeParse(entry.remote_state);
  if (parsedRemote.success) {
    return parsedRemote.data;
  }

  return undefined;
};

/** Build a GraphNode for a real plan resource entry. */
const buildResourceNode = (key: string, entry: PlanEntry): ResourceGraphNode => ({
  id: key,
  label: extractResourceName(key),
  nodeKind: "resource",
  diffState: mapActionToDiffState(entry.action),
  resourceKey: key,
  changes: entry.changes,
  resourceState: extractResourceState(entry),
});

/** Build a virtual container node (UC root, catalog, workspace root). */
const buildGroupNode = (id: string, label: string, external = false): ResourceGroupGraphNode => ({
  id,
  label,
  nodeKind: "resource-group",
  diffState: "unchanged",
  resourceKey: id,
  changes: undefined,
  resourceState: undefined,
  external,
});

/** Map an entry's action to an edge diff state. */
const entryEdgeDiffState = (entry: PlanEntry) =>
  toEdgeDiffState(mapActionToDiffState(entry.action));

/** Build a unique edge, returning undefined if source === target. */
const buildEdge = (
  source: string,
  target: string,
  diffState: GraphEdge["diffState"] = "unchanged",
): GraphEdge | undefined =>
  source === target
    ? undefined
    : {
        id: `${source}→${target}`,
        source,
        target,
        label: undefined,
        diffState,
      };

/** Filter defined edges from buildEdge results. */
const filterDefinedEdges = (edges: readonly (GraphEdge | undefined)[]): readonly GraphEdge[] =>
  edges.filter((e): e is GraphEdge => e !== undefined);

/** Build a lookup from "catalog.schema" → schema plan key for linking volumes/models to schemas. */
const buildSchemaLookup = (
  ucEntries: readonly (readonly [string, PlanEntry])[],
): ReadonlyMap<string, string> =>
  new Map(
    ucEntries
      .filter(([key]) => {
        const rt = extractResourceType(key);
        return rt !== undefined && SCHEMA_TIER_TYPES.has(rt);
      })
      .flatMap(([key, entry]) => {
        const name = extractStateField(entry, "name");
        const catalog = extractStateField(entry, "catalog_name");
        return name !== undefined && catalog !== undefined
          ? [[`${catalog}.${name}`, key] as const]
          : [];
      }),
  );

/** Build a set of catalog names that are actual plan entries (not just referenced). */
const buildCatalogLookup = (
  ucEntries: readonly (readonly [string, PlanEntry])[],
): ReadonlySet<string> =>
  new Set(
    ucEntries
      .filter(([key]) => {
        const rt = extractResourceType(key);
        return rt !== undefined && CATALOG_TIER_TYPES.has(rt);
      })
      .flatMap(([, entry]) => {
        const name = extractStateField(entry, "name");
        return name !== undefined ? [name] : [];
      }),
  );

/** Build phantom schema nodes for UC resources whose schema is not in the plan. */
const buildPhantomSchemaNodes = (
  ucEntries: readonly (readonly [string, PlanEntry])[],
  schemaLookup: ReadonlyMap<string, string>,
): ReadonlyMap<
  string,
  { readonly node: ResourceGroupGraphNode; readonly parentEdge: GraphEdge | undefined }
> => {
  const phantomEntries = ucEntries.flatMap(([key, entry]) => {
    const resourceType = extractResourceType(key);
    if (
      resourceType !== undefined &&
      (CATALOG_TIER_TYPES.has(resourceType) || SCHEMA_TIER_TYPES.has(resourceType))
    )
      return [];

    const schemaName = extractStateField(entry, "schema_name");
    const catalog = extractStateField(entry, "catalog_name");
    if (schemaName === undefined || catalog === undefined) return [];
    if (schemaLookup.has(`${catalog}.${schemaName}`)) return [];

    const phantomId = `external::${catalog}.${schemaName}`;
    const catalogId = `catalog::${catalog}`;
    return [
      [
        phantomId,
        {
          node: buildGroupNode(phantomId, schemaName, true),
          parentEdge: buildEdge(catalogId, phantomId),
        },
      ] as const,
    ];
  });

  return new Map(phantomEntries);
};

/** Build the UC hierarchy subgraph: root, catalogs, schemas, phantom schemas, and resource nodes. */
const buildUcGraph = (
  ucEntries: readonly (readonly [string, PlanEntry])[],
  schemaLookup: ReadonlyMap<string, string>,
  catalogLookup: ReadonlySet<string>,
): PlanGraph => {
  if (ucEntries.length === 0) return { nodes: [], edges: [] };

  const ucRoot = buildGroupNode("uc-root", "Unity Catalog");

  // Unique catalog names → catalog group nodes + edges from UC root
  const catalogNames = [
    ...new Set(
      ucEntries.flatMap(([, entry]) => {
        const catalog = extractStateField(entry, "catalog_name");
        return catalog !== undefined ? [catalog] : [];
      }),
    ),
  ];
  const catalogNodes = catalogNames.map((name) =>
    buildGroupNode(`catalog::${name}`, name, !catalogLookup.has(name)),
  );
  const catalogEdges = filterDefinedEdges(
    catalogNames.map((name) => buildEdge("uc-root", `catalog::${name}`)),
  );

  // Phantom schema nodes (deduplicated by Map key)
  const phantomMap = buildPhantomSchemaNodes(ucEntries, schemaLookup);
  const phantomNodes = [...phantomMap.values()].map(({ node }) => node);
  const phantomEdges = filterDefinedEdges(
    [...phantomMap.values()].map(({ parentEdge }) => parentEdge),
  );

  // Resource nodes + hierarchy edges
  const resourceNodes = ucEntries.map(([key, entry]) => buildResourceNode(key, entry));
  const hierarchyEdges = filterDefinedEdges(
    ucEntries.map(([key, entry]) => {
      const resourceType = extractResourceType(key);
      const catalog = extractStateField(entry, "catalog_name");
      const catalogId = catalog !== undefined ? `catalog::${catalog}` : "uc-root";
      const edgeDiff = entryEdgeDiffState(entry);

      if (
        resourceType !== undefined &&
        (SCHEMA_TIER_TYPES.has(resourceType) || CATALOG_TIER_TYPES.has(resourceType))
      ) {
        return buildEdge(catalogId, key, edgeDiff);
      }

      const schemaName = extractStateField(entry, "schema_name");
      const schemaKey =
        schemaName !== undefined && catalog !== undefined
          ? schemaLookup.get(`${catalog}.${schemaName}`)
          : undefined;

      if (schemaKey !== undefined) return buildEdge(schemaKey, key, edgeDiff);
      if (schemaName !== undefined && catalog !== undefined) {
        return buildEdge(`external::${catalog}.${schemaName}`, key, edgeDiff);
      }
      return buildEdge(catalogId, key, edgeDiff);
    }),
  );

  return {
    nodes: [ucRoot, ...catalogNodes, ...phantomNodes, ...resourceNodes],
    edges: [...catalogEdges, ...phantomEdges, ...hierarchyEdges],
  };
};

/** Build the workspace subgraph: root node + flat resource nodes with edges. */
const buildWorkspaceGraph = (
  workspaceEntries: readonly (readonly [string, PlanEntry])[],
): PlanGraph => {
  if (workspaceEntries.length === 0) return { nodes: [], edges: [] };

  const root = buildGroupNode("workspace-root", "Workspace");
  const resourceNodes = workspaceEntries.map(([key, entry]) => buildResourceNode(key, entry));
  const resourceEdges = filterDefinedEdges(
    workspaceEntries.map(([key, entry]) =>
      buildEdge("workspace-root", key, entryEdgeDiffState(entry)),
    ),
  );

  return {
    nodes: [root, ...resourceNodes],
    edges: resourceEdges,
  };
};

/** Collect explicit depends_on edges, skipping job-to-job edges (deployment ordering, not hierarchy). */
const collectDependsOnEdges = (
  entries: readonly (readonly [string, PlanEntry])[],
): readonly GraphEdge[] =>
  filterDefinedEdges(
    entries.flatMap(([key, entry]) =>
      (entry.depends_on ?? [])
        .filter((dep) => !(isJobEntry(key) && isJobEntry(dep.node)))
        .map((dep) => buildEdge(dep.node, key, entryEdgeDiffState(entry))),
    ),
  );

/** Deduplicate edges, keeping the first occurrence of each edge id. */
const deduplicateEdges = (edges: readonly GraphEdge[]): readonly GraphEdge[] => {
  const seen = new Set<string>();
  return edges.filter((edge) => {
    if (seen.has(edge.id)) return false;
    seen.add(edge.id);
    return true;
  });
};

/** Build the complete resource graph for all plan entries. */
export const buildResourceGraph = (plan: Plan): PlanGraph => {
  const entries = Object.entries(plan.plan ?? {});

  if (entries.length === 0) return { nodes: [], edges: [] };

  const ucEntries = entries.filter(([key]) => {
    const resourceType = extractResourceType(key);
    return resourceType !== undefined && isUnityCatalogType(resourceType);
  });
  const workspaceEntries = entries.filter(([key]) => {
    const resourceType = extractResourceType(key);
    return resourceType === undefined || !isUnityCatalogType(resourceType);
  });

  const schemaLookup = buildSchemaLookup(ucEntries);
  const catalogLookup = buildCatalogLookup(ucEntries);
  const ucGraph = buildUcGraph(ucEntries, schemaLookup, catalogLookup);
  const workspaceGraph = buildWorkspaceGraph(workspaceEntries);
  const dependsOnEdges = collectDependsOnEdges(entries);

  return {
    nodes: [...ucGraph.nodes, ...workspaceGraph.nodes],
    edges: deduplicateEdges([...ucGraph.edges, ...workspaceGraph.edges, ...dependsOnEdges]),
  };
};
