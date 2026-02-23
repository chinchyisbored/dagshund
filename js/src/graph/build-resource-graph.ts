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
import { filterJobLevelChanges } from "../utils/task-key.ts";
import { buildTaskChangeSummary } from "./build-task-change-summary.ts";
import { resolveJobState, resolveTaskEntries } from "./extract-tasks.ts";

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

/** All Postgres resource types. */
const POSTGRES_TYPES: ReadonlySet<string> = new Set([
  "postgres_projects",
  "postgres_branches",
  "postgres_endpoints",
]);

/** All Lakebase resource types (database_catalogs stays in UC). */
const LAKEBASE_TYPES: ReadonlySet<string> = new Set([
  "database_instances",
  "synced_database_tables",
]);

/** Extract the resource type segment from a plan key like "resources.schemas.analytics". */
export const extractResourceType = (key: string): string | undefined => key.split(".")[1];

/** Check whether a plan key represents a job entry. */
export const isJobEntry = (key: string): boolean => key.startsWith("resources.jobs.");

/** Check whether a resource type belongs under Unity Catalog. */
export const isUnityCatalogType = (resourceType: string): boolean => UC_TYPES.has(resourceType);

/** Check whether a resource type belongs under the Postgres hierarchy. */
export const isPostgresType = (resourceType: string): boolean => POSTGRES_TYPES.has(resourceType);

/** Check whether a resource type belongs under the Lakebase hierarchy. */
export const isLakebaseType = (resourceType: string): boolean => LAKEBASE_TYPES.has(resourceType);

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
const buildResourceNode = (key: string, entry: PlanEntry): ResourceGraphNode => {
  if (isJobEntry(key)) {
    const tasks = resolveTaskEntries(entry.new_state, entry.remote_state);
    return {
      id: key,
      label: extractResourceName(key),
      nodeKind: "resource",
      diffState: mapActionToDiffState(entry.action),
      resourceKey: key,
      changes: filterJobLevelChanges(entry.changes),
      resourceState: resolveJobState(entry.new_state, entry.remote_state),
      taskChangeSummary: buildTaskChangeSummary(tasks, entry.action, entry.changes),
    };
  }
  return {
    id: key,
    label: extractResourceName(key),
    nodeKind: "resource",
    diffState: mapActionToDiffState(entry.action),
    resourceKey: key,
    changes: entry.changes,
    resourceState: extractResourceState(entry),
    taskChangeSummary: undefined,
  };
};

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

/**
 * Configuration for a generic resource hierarchy (Postgres, Lakebase).
 * Assumes parent fields contain resource name strings matching the parent's `name` field.
 */
type HierarchySpec = {
  readonly rootId: string;
  readonly rootLabel: string;
  readonly containerTypes: ReadonlySet<string>;
  readonly containerIdPrefix: string;
  readonly midTierConfig?: {
    readonly types: ReadonlySet<string>;
    readonly parentField: string;
    readonly phantomIdPrefix: string;
  };
  readonly leafParentField: string;
};

const POSTGRES_SPEC: HierarchySpec = {
  rootId: "postgres-root",
  rootLabel: "Lakebase Autoscaling",
  containerTypes: new Set(["postgres_projects"]),
  containerIdPrefix: "postgres-project::",
  midTierConfig: {
    types: new Set(["postgres_branches"]),
    parentField: "parent",
    phantomIdPrefix: "external::postgres-branch::",
  },
  leafParentField: "parent",
};

const LAKEBASE_SPEC: HierarchySpec = {
  rootId: "lakebase-root",
  rootLabel: "Lakebase Provisioned",
  containerTypes: new Set(["database_instances"]),
  containerIdPrefix: "lakebase-instance::",
  leafParentField: "database_instance_name",
};

/**
 * Build a hierarchy subgraph from a spec: root → container groups → optional mid-tier → leaf resources.
 * Additional container names (e.g. from cross-hierarchy references) create external group nodes.
 */
const buildHierarchySubgraph = (
  entries: readonly (readonly [string, PlanEntry])[],
  spec: HierarchySpec,
  additionalContainerNames: ReadonlySet<string> = new Set(),
): PlanGraph => {
  if (entries.length === 0 && additionalContainerNames.size === 0) return { nodes: [], edges: [] };

  const root = buildGroupNode(spec.rootId, spec.rootLabel);
  const midTierConfig = spec.midTierConfig;

  // Container names from actual entries (determines external flag)
  const entryContainerNames = new Set(
    entries
      .filter(([key]) => {
        const rt = extractResourceType(key);
        return rt !== undefined && spec.containerTypes.has(rt);
      })
      .flatMap(([, entry]) => {
        const name = extractStateField(entry, "name");
        return name !== undefined ? [name] : [];
      }),
  );

  // All referenced container names: entries + parent references + additional
  // Local mutation: accumulating names from multiple sources into one set
  const allContainerNames = new Set([...entryContainerNames, ...additionalContainerNames]);
  if (midTierConfig !== undefined) {
    for (const [key, entry] of entries) {
      const rt = extractResourceType(key);
      if (rt !== undefined && midTierConfig.types.has(rt)) {
        const name = extractStateField(entry, midTierConfig.parentField);
        if (name !== undefined) allContainerNames.add(name);
      }
    }
  } else {
    for (const [key, entry] of entries) {
      const rt = extractResourceType(key);
      if (rt !== undefined && !spec.containerTypes.has(rt)) {
        const name = extractStateField(entry, spec.leafParentField);
        if (name !== undefined) allContainerNames.add(name);
      }
    }
  }

  // Container group nodes + root → container edges
  const containerNodes = [...allContainerNames].map((name) =>
    buildGroupNode(`${spec.containerIdPrefix}${name}`, name, !entryContainerNames.has(name)),
  );
  const containerEdges = filterDefinedEdges(
    [...allContainerNames].map((name) =>
      buildEdge(spec.rootId, `${spec.containerIdPrefix}${name}`),
    ),
  );

  // Mid-tier lookup: name → plan key (only when mid-tier config exists)
  const midTierLookup =
    midTierConfig !== undefined
      ? new Map(
          entries
            .filter(([key]) => {
              const rt = extractResourceType(key);
              return rt !== undefined && midTierConfig.types.has(rt);
            })
            .flatMap(([key, entry]) => {
              const name = extractStateField(entry, "name");
              return name !== undefined ? [[name, key] as const] : [];
            }),
        )
      : undefined;

  // Phantom mid-tier nodes for leaves whose parent isn't in the plan
  const phantomMidTierMap =
    midTierConfig !== undefined && midTierLookup !== undefined
      ? new Map(
          entries.flatMap(([key, entry]) => {
            const rt = extractResourceType(key);
            if (rt === undefined || spec.containerTypes.has(rt) || midTierConfig.types.has(rt))
              return [];
            const parentName = extractStateField(entry, spec.leafParentField);
            if (parentName === undefined || midTierLookup.has(parentName)) return [];
            const phantomId = `${midTierConfig.phantomIdPrefix}${parentName}`;
            return [[phantomId, parentName] as const];
          }),
        )
      : new Map<string, string>();

  const phantomNodes = [...phantomMidTierMap].map(([phantomId, name]) =>
    buildGroupNode(phantomId, name, true),
  );
  const phantomEdges = filterDefinedEdges(
    [...phantomMidTierMap.keys()].map((phantomId) => buildEdge(spec.rootId, phantomId)),
  );

  // Resource nodes for all entries
  const resourceNodes = entries.map(([key, entry]) => buildResourceNode(key, entry));

  // Hierarchy edges: connect each entry to its parent in the hierarchy
  const hierarchyEdges = filterDefinedEdges(
    entries.map(([key, entry]) => {
      const rt = extractResourceType(key);
      if (rt === undefined) return undefined;
      const edgeDiff = entryEdgeDiffState(entry);

      // Container entries → container group node
      if (spec.containerTypes.has(rt)) {
        const name = extractStateField(entry, "name");
        return buildEdge(
          name !== undefined ? `${spec.containerIdPrefix}${name}` : spec.rootId,
          key,
          edgeDiff,
        );
      }

      // Mid-tier entries → container group (via parentField)
      if (midTierConfig?.types.has(rt)) {
        const parentName = extractStateField(entry, midTierConfig.parentField);
        return buildEdge(
          parentName !== undefined ? `${spec.containerIdPrefix}${parentName}` : spec.rootId,
          key,
          edgeDiff,
        );
      }

      // Leaf entries
      const parentName = extractStateField(entry, spec.leafParentField);
      if (parentName === undefined) return buildEdge(spec.rootId, key, edgeDiff);

      if (midTierLookup !== undefined && midTierConfig !== undefined) {
        const midTierKey = midTierLookup.get(parentName);
        return midTierKey !== undefined
          ? buildEdge(midTierKey, key, edgeDiff)
          : buildEdge(`${midTierConfig.phantomIdPrefix}${parentName}`, key, edgeDiff);
      }

      return buildEdge(`${spec.containerIdPrefix}${parentName}`, key, edgeDiff);
    }),
  );

  return {
    nodes: [root, ...containerNodes, ...phantomNodes, ...resourceNodes],
    edges: [...containerEdges, ...phantomEdges, ...hierarchyEdges],
  };
};

/** Build the workspace subgraph: flat resources + Postgres/Lakebase hierarchies. */
const buildWorkspaceGraph = (
  workspaceEntries: readonly (readonly [string, PlanEntry])[],
  postgresEntries: readonly (readonly [string, PlanEntry])[],
  lakebaseEntries: readonly (readonly [string, PlanEntry])[],
  crossReferencedInstances: ReadonlySet<string>,
): PlanGraph => {
  const hasWorkspace = workspaceEntries.length > 0;
  const hasPostgres = postgresEntries.length > 0;
  const hasLakebase = lakebaseEntries.length > 0 || crossReferencedInstances.size > 0;

  if (!hasWorkspace && !hasPostgres && !hasLakebase) return { nodes: [], edges: [] };

  const root = buildGroupNode("workspace-root", "Workspace");

  // Postgres hierarchy
  const pgGraph = hasPostgres
    ? buildHierarchySubgraph(postgresEntries, POSTGRES_SPEC)
    : { nodes: [], edges: [] };
  const pgRootEdge = hasPostgres
    ? filterDefinedEdges([buildEdge("workspace-root", "postgres-root")])
    : [];

  // Lakebase hierarchy
  const lbGraph = hasLakebase
    ? buildHierarchySubgraph(lakebaseEntries, LAKEBASE_SPEC, crossReferencedInstances)
    : { nodes: [], edges: [] };
  const lbRootEdge = hasLakebase
    ? filterDefinedEdges([buildEdge("workspace-root", "lakebase-root")])
    : [];

  // Flat workspace resources — wrap in "Other Resources" group when hierarchies exist
  const hasHierarchies = hasPostgres || hasLakebase;
  const wrapFlat = hasWorkspace && hasHierarchies;
  const flatParentId = wrapFlat ? "other-resources-root" : "workspace-root";

  const flatNodes = workspaceEntries.map(([key, entry]) => buildResourceNode(key, entry));
  const flatEdges = filterDefinedEdges(
    workspaceEntries.map(([key, entry]) => buildEdge(flatParentId, key, entryEdgeDiffState(entry))),
  );
  const otherResourcesNodes = wrapFlat
    ? [buildGroupNode("other-resources-root", "Other Resources")]
    : [];
  const otherResourcesEdge = wrapFlat
    ? filterDefinedEdges([buildEdge("workspace-root", "other-resources-root")])
    : [];

  return {
    nodes: [root, ...otherResourcesNodes, ...flatNodes, ...pgGraph.nodes, ...lbGraph.nodes],
    edges: [
      ...otherResourcesEdge,
      ...flatEdges,
      ...pgRootEdge,
      ...pgGraph.edges,
      ...lbRootEdge,
      ...lbGraph.edges,
    ],
  };
};

/** Collect cross-hierarchy edges from Lakebase instances to UC database_catalogs. */
const collectLakebaseCrossEdges = (
  ucEntries: readonly (readonly [string, PlanEntry])[],
): {
  readonly edges: readonly GraphEdge[];
  readonly instanceNames: ReadonlySet<string>;
} => {
  const instanceNames = new Set<string>();
  const edges: GraphEdge[] = [];

  for (const [key, entry] of ucEntries) {
    const rt = extractResourceType(key);
    if (rt !== "database_catalogs") continue;
    const instanceName = extractStateField(entry, "database_instance_name");
    if (instanceName === undefined) continue;
    instanceNames.add(instanceName);
    const edge = buildEdge(`lakebase-instance::${instanceName}`, key);
    if (edge !== undefined) edges.push(edge);
  }

  return { edges, instanceNames };
};

/** Parse a three-part UC name ("catalog.schema.table") into components.
 *  Returns undefined if the name doesn't have exactly three dot-separated parts. */
export const parseThreePartName = (
  name: string,
): { readonly catalog: string; readonly schema: string; readonly table: string } | undefined => {
  const parts = name.split(".");
  // length === 3 guarantees these indices exist; TS cannot narrow array access from length checks
  return parts.length === 3
    ? { catalog: parts[0] as string, schema: parts[1] as string, table: parts[2] as string }
    : undefined;
};

/** Collect lateral sync edges from synced_database_tables to phantom UC table nodes.
 *  Creates phantom table and schema nodes as needed for the UC hierarchy. */
const collectSyncTableEdges = (
  lakebaseEntries: readonly (readonly [string, PlanEntry])[],
  schemaLookup: ReadonlyMap<string, string>,
  existingUcNodeIds: ReadonlySet<string>,
): {
  readonly syncEdges: readonly GraphEdge[];
  readonly phantomNodes: readonly ResourceGroupGraphNode[];
  readonly phantomEdges: readonly GraphEdge[];
  readonly referencedCatalogs: ReadonlySet<string>;
} => {
  const phantomTableMap = new Map<
    string,
    { readonly node: ResourceGroupGraphNode; readonly parentEdge: GraphEdge | undefined }
  >();
  const phantomSchemaMap = new Map<
    string,
    { readonly node: ResourceGroupGraphNode; readonly parentEdge: GraphEdge | undefined }
  >();
  const syncEdges: GraphEdge[] = [];
  const referencedCatalogs = new Set<string>();

  for (const [key, entry] of lakebaseEntries) {
    if (extractResourceType(key) !== "synced_database_tables") continue;

    const name = extractStateField(entry, "name");
    if (name === undefined) continue;

    const parsed = parseThreePartName(name);
    if (parsed === undefined) continue;

    referencedCatalogs.add(parsed.catalog);

    const tableId = `sync-target::${parsed.catalog}.${parsed.schema}.${parsed.table}`;
    const schemaQualified = `${parsed.catalog}.${parsed.schema}`;
    const realSchemaKey = schemaLookup.get(schemaQualified);
    const phantomSchemaId = `external::${schemaQualified}`;
    const schemaParentId = realSchemaKey ?? phantomSchemaId;

    // Phantom schema if no real schema and not already in the UC graph
    if (
      realSchemaKey === undefined &&
      !existingUcNodeIds.has(phantomSchemaId) &&
      !phantomSchemaMap.has(schemaQualified)
    ) {
      phantomSchemaMap.set(schemaQualified, {
        node: buildGroupNode(phantomSchemaId, parsed.schema, true),
        parentEdge: buildEdge(`catalog::${parsed.catalog}`, phantomSchemaId),
      });
    }

    // Phantom table — uses resource-group nodeKind for external/dashed visual treatment despite being a leaf
    if (!phantomTableMap.has(tableId)) {
      phantomTableMap.set(tableId, {
        node: buildGroupNode(tableId, parsed.table, true),
        parentEdge: buildEdge(schemaParentId, tableId),
      });
    }

    // Sync edge from phantom UC table to synced_database_table (data flows UC → Lakebase)
    const syncEdge = buildEdge(tableId, key, entryEdgeDiffState(entry));
    if (syncEdge !== undefined) syncEdges.push({ ...syncEdge, edgeKind: "sync" });
  }

  return {
    syncEdges,
    phantomNodes: [
      ...[...phantomSchemaMap.values()].map(({ node }) => node),
      ...[...phantomTableMap.values()].map(({ node }) => node),
    ],
    phantomEdges: filterDefinedEdges([
      ...[...phantomSchemaMap.values()].map(({ parentEdge }) => parentEdge),
      ...[...phantomTableMap.values()].map(({ parentEdge }) => parentEdge),
    ]),
    referencedCatalogs,
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

  const ucEntries: [string, PlanEntry][] = [];
  const postgresEntries: [string, PlanEntry][] = [];
  const lakebaseEntries: [string, PlanEntry][] = [];
  const workspaceEntries: [string, PlanEntry][] = [];
  for (const entry of entries) {
    const resourceType = extractResourceType(entry[0]);
    if (resourceType !== undefined && isUnityCatalogType(resourceType)) {
      ucEntries.push(entry);
    } else if (resourceType !== undefined && isPostgresType(resourceType)) {
      postgresEntries.push(entry);
    } else if (resourceType !== undefined && isLakebaseType(resourceType)) {
      lakebaseEntries.push(entry);
    } else {
      workspaceEntries.push(entry);
    }
  }

  const schemaLookup = buildSchemaLookup(ucEntries);
  const catalogLookup = buildCatalogLookup(ucEntries);
  const ucGraph = buildUcGraph(ucEntries, schemaLookup, catalogLookup);

  const { edges: crossEdges, instanceNames: crossReferencedInstances } =
    collectLakebaseCrossEdges(ucEntries);

  // Sync edges: synced_database_table → phantom UC table
  const existingUcNodeIds = new Set(ucGraph.nodes.map((n) => n.id));
  const {
    syncEdges,
    phantomNodes: syncPhantomNodes,
    phantomEdges: syncPhantomEdges,
    referencedCatalogs: syncReferencedCatalogs,
  } = collectSyncTableEdges(lakebaseEntries, schemaLookup, existingUcNodeIds);

  // If sync edges reference catalogs not in the UC graph, create group nodes
  const existingCatalogs = new Set(
    ucGraph.nodes.filter((n) => n.id.startsWith("catalog::")).map((n) => n.id.slice(9)),
  );
  const missingCatalogs = [...syncReferencedCatalogs].filter((c) => !existingCatalogs.has(c));
  const extraCatalogNodes = missingCatalogs.map((name) =>
    buildGroupNode(`catalog::${name}`, name, !catalogLookup.has(name)),
  );
  const extraCatalogEdges = filterDefinedEdges(
    missingCatalogs.map((name) => buildEdge("uc-root", `catalog::${name}`)),
  );

  // If we need sync phantom nodes but no UC root exists, bootstrap it
  const needsUcRoot =
    ucGraph.nodes.length === 0 && (syncPhantomNodes.length > 0 || extraCatalogNodes.length > 0);
  const ucRootForSync = needsUcRoot ? [buildGroupNode("uc-root", "Unity Catalog")] : [];

  const workspaceGraph = buildWorkspaceGraph(
    workspaceEntries,
    postgresEntries,
    lakebaseEntries,
    crossReferencedInstances,
  );
  const dependsOnEdges = collectDependsOnEdges(entries);

  return {
    nodes: [
      ...ucGraph.nodes,
      ...ucRootForSync,
      ...extraCatalogNodes,
      ...syncPhantomNodes,
      ...workspaceGraph.nodes,
    ],
    edges: deduplicateEdges([
      ...ucGraph.edges,
      ...extraCatalogEdges,
      ...syncPhantomEdges,
      ...workspaceGraph.edges,
      ...crossEdges,
      ...syncEdges,
      ...dependsOnEdges,
    ]),
  };
};
