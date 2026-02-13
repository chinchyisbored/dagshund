import { z } from "zod/v4";
import { mapActionToDiffState } from "../parser/map-diff-state.ts";
import type { EdgeDiffState, GraphEdge, GraphNode, PlanGraph } from "../types/graph-types.ts";
import type { Plan, PlanEntry } from "../types/plan-schema.ts";
import { extractResourceName } from "../utils/resource-key.ts";

/** Schema for new_state: { value: { ...fields } }. */
const newStateSchema = z.object({
  value: z.record(z.string(), z.unknown()).readonly().optional(),
}).readonly();

/** Schema for remote_state: { ...fields }. */
const remoteStateSchema = z.record(z.string(), z.unknown()).readonly();

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

/** Map an entry's action to an edge diff state (added/removed only; modified → unchanged). */
const toEdgeDiffState = (entry: PlanEntry): EdgeDiffState => {
  const state = mapActionToDiffState(entry.action);
  return state === "added" || state === "removed" ? state : "unchanged";
};

/** Build a unique edge, returning undefined if source === target. */
const buildEdge = (source: string, target: string, diffState: GraphEdge["diffState"] = "unchanged"): GraphEdge | undefined =>
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
const filterDefinedEdges = (
  edges: readonly (GraphEdge | undefined)[],
): readonly GraphEdge[] => edges.filter((e): e is GraphEdge => e !== undefined);

/** Build a lookup from "catalog.schema" → schema plan key for linking volumes/models to schemas. */
const buildSchemaLookup = (
  ucEntries: readonly (readonly [string, PlanEntry])[],
): ReadonlyMap<string, string> =>
  new Map(
    ucEntries
      .filter(([key]) => extractResourceType(key) === "schemas")
      .flatMap(([key, entry]) => {
        const name = extractStateField(entry, "name");
        const catalog = extractStateField(entry, "catalog_name");
        return name !== undefined && catalog !== undefined
          ? [[`${catalog}.${name}`, key] as const]
          : [];
      }),
  );

/** Build phantom schema nodes for UC resources whose schema is not in the plan. */
const buildPhantomSchemaNodes = (
  ucEntries: readonly (readonly [string, PlanEntry])[],
  schemaLookup: ReadonlyMap<string, string>,
): ReadonlyMap<string, { readonly node: GraphNode; readonly parentEdge: GraphEdge | undefined }> => {
  const phantomEntries = ucEntries.flatMap(([key, entry]) => {
    const resourceType = extractResourceType(key);
    if (resourceType === "schemas" || resourceType === "catalogs") return [];

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
  const catalogNodes = catalogNames.map((name) => buildGroupNode(`catalog::${name}`, name));
  const catalogEdges = filterDefinedEdges(
    catalogNames.map((name) => buildEdge("uc-root", `catalog::${name}`)),
  );

  // Phantom schema nodes (deduplicated by Map key)
  const phantomMap = buildPhantomSchemaNodes(ucEntries, schemaLookup);
  const phantomNodes = [...phantomMap.values()].map(({ node }) => node);
  const phantomEdges = filterDefinedEdges([...phantomMap.values()].map(({ parentEdge }) => parentEdge));

  // Resource nodes + hierarchy edges
  const resourceNodes = ucEntries.map(([key, entry]) => buildResourceNode(key, entry));
  const hierarchyEdges = filterDefinedEdges(
    ucEntries.map(([key, entry]) => {
      const resourceType = extractResourceType(key);
      const catalog = extractStateField(entry, "catalog_name");
      const catalogId = catalog !== undefined ? `catalog::${catalog}` : "uc-root";
      const edgeDiff = toEdgeDiffState(entry);

      if (resourceType === "schemas" || resourceType === "catalogs") {
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
    workspaceEntries.map(([key, entry]) => buildEdge("workspace-root", key, toEdgeDiffState(entry))),
  );

  return {
    nodes: [root, ...resourceNodes],
    edges: resourceEdges,
  };
};

/** Collect explicit depends_on edges from all plan entries. */
const collectDependsOnEdges = (
  entries: readonly (readonly [string, PlanEntry])[],
): readonly GraphEdge[] =>
  filterDefinedEdges(
    entries.flatMap(([key, entry]) =>
      (entry.depends_on ?? []).map((dep) => buildEdge(dep.node, key, toEdgeDiffState(entry))),
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

/** Build the complete resource graph for non-job plan entries. */
export const buildResourceGraph = (plan: Plan): PlanGraph => {
  const entries = Object.entries(plan.plan ?? {}).filter(([key]) => !isJobEntry(key));

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
  const ucGraph = buildUcGraph(ucEntries, schemaLookup);
  const workspaceGraph = buildWorkspaceGraph(workspaceEntries);
  const dependsOnEdges = collectDependsOnEdges(entries);

  return {
    nodes: [...ucGraph.nodes, ...workspaceGraph.nodes],
    edges: deduplicateEdges([...ucGraph.edges, ...workspaceGraph.edges, ...dependsOnEdges]),
  };
};

/** Check whether a plan has any non-job resource entries. */
export const hasNonJobResources = (plan: Plan): boolean =>
  Object.keys(plan.plan ?? {}).some((key) => !isJobEntry(key));
