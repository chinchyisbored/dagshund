import { mapActionToDiffState } from "../parser/map-diff-state.ts";
import {
  buildGraphEdge,
  type GraphEdge,
  type PhantomGraphNode,
  type PlanGraph,
  type ResourceGraphNode,
  type RootGraphNode,
  toEdgeDiffState,
} from "../types/graph-types.ts";
import type { Plan, PlanEntry } from "../types/plan-schema.ts";
import {
  DATABASE_INSTANCE_SOURCE_TYPES,
  extractResourceName,
  extractResourceType,
} from "../utils/resource-key.ts";
import { filterJobLevelChanges } from "../utils/task-key.ts";
import { buildTaskChangeSummary } from "./build-task-change-summary.ts";
import { extractLateralEdges } from "./extract-lateral-edges.ts";
import {
  extractResourceState,
  extractSourceTableFullName,
  extractStateField,
  parseThreePartName,
} from "./extract-resource-state.ts";
import { resolveJobState, resolveTaskEntries, type TaskEntry } from "./extract-tasks.ts";

// ---------------------------------------------------------------------------
// Type classification sets
// ---------------------------------------------------------------------------

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
  "synced_database_tables",
]);

/** All Postgres resource types. */
const POSTGRES_TYPES: ReadonlySet<string> = new Set([
  "postgres_projects",
  "postgres_branches",
  "postgres_endpoints",
]);

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Check whether a plan key represents a job entry. */
export const isJobEntry = (key: string): boolean => key.startsWith("resources.jobs.");

/** Check whether a resource type belongs under Unity Catalog. */
export const isUnityCatalogType = (resourceType: string): boolean => UC_TYPES.has(resourceType);

/** Check whether a resource type belongs under the Postgres hierarchy. */
export const isPostgresType = (resourceType: string): boolean => POSTGRES_TYPES.has(resourceType);

// ---------------------------------------------------------------------------
// Node builders
// ---------------------------------------------------------------------------

/** Shared fields for job nodes across both plan and resource graph views. */
export const buildJobFields = (
  resourceKey: string,
  entry: PlanEntry,
  tasks: readonly TaskEntry[],
) => ({
  label: extractResourceName(resourceKey),
  diffState: mapActionToDiffState(entry.action),
  changes: filterJobLevelChanges(entry.changes),
  resourceState: resolveJobState(entry.new_state, entry.remote_state),
  taskChangeSummary: buildTaskChangeSummary(tasks, entry.action, entry.changes),
});

/** Build a GraphNode for a real plan resource entry. */
const buildResourceNode = (key: string, entry: PlanEntry): ResourceGraphNode => {
  if (isJobEntry(key)) {
    const tasks = resolveTaskEntries(entry.new_state, entry.remote_state);
    return {
      id: key,
      nodeKind: "resource",
      resourceKey: key,
      ...buildJobFields(key, entry, tasks),
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

/** Build a resource node with a hierarchy ID (for container-tier resources like catalogs, projects). */
const buildContainerResourceNode = (
  hierarchyId: string,
  key: string,
  entry: PlanEntry,
): ResourceGraphNode => ({
  id: hierarchyId,
  label: extractResourceName(key),
  nodeKind: "resource",
  diffState: mapActionToDiffState(entry.action),
  resourceKey: key,
  changes: entry.changes,
  resourceState: extractResourceState(entry),
  taskChangeSummary: undefined,
});

/** Build a structural root node (UC root, workspace root, etc). */
const buildRootNode = (id: string, label: string): RootGraphNode => ({
  id,
  label,
  nodeKind: "root",
  diffState: "unchanged",
  resourceKey: id,
  changes: undefined,
  resourceState: undefined,
});

/** Build a phantom node for an inferred ancestor not in the plan. */
const buildPhantomNode = (id: string, label: string): PhantomGraphNode => ({
  id,
  label,
  nodeKind: "phantom",
  diffState: "unchanged",
  resourceKey: id,
  changes: undefined,
  resourceState: undefined,
});

// ---------------------------------------------------------------------------
// Edge helpers (unchanged)
// ---------------------------------------------------------------------------

/** Map an entry's action to an edge diff state. */
const entryEdgeDiffState = (entry: PlanEntry) =>
  toEdgeDiffState(mapActionToDiffState(entry.action));

/** Build a unique edge, returning undefined if source === target (self-loop guard). */
const buildEdge = (
  source: string,
  target: string,
  diffState: GraphEdge["diffState"] = "unchanged",
): GraphEdge | undefined =>
  source === target ? undefined : buildGraphEdge(source, target, diffState);

/** Filter defined edges from buildEdge results. */
const filterDefinedEdges = (edges: readonly (GraphEdge | undefined)[]): readonly GraphEdge[] =>
  edges.filter((e): e is GraphEdge => e !== undefined);

// ---------------------------------------------------------------------------
// Chain spec types
// ---------------------------------------------------------------------------

/**
 * Return type for resolveParentRef:
 * - string: identity at the tier immediately above (tier - 1)
 * - object: identity at a specific tier (for skipping tiers, e.g. volume → catalog when schema is missing)
 */
type ParentRef = string | { readonly identity: string; readonly tierIndex: number };

/** A single tier in a hierarchy chain (e.g. catalog, schema, project, branch). */
type TierSpec = {
  /** Human-readable name — used for badges and labels. */
  readonly name: string;
  /** Plan resource types that sit at this tier. */
  readonly resourceTypes: ReadonlySet<string>;
  /** Extract this node's identity (the key children use to reference it). */
  readonly resolveIdentity: (entry: PlanEntry, key: string) => string | undefined;
  /** Extract the parent's identity at the tier above. Returns string for tier-1, object for a specific tier. */
  readonly resolveParentRef: (entry: PlanEntry, key: string) => ParentRef | undefined;
  /** Derive a phantom's parent identity from its own identity (for upward chain propagation). */
  readonly deriveParentRef?: (identity: string) => string | undefined;
  /** Build the node ID for this tier (used by both real container nodes and phantoms). */
  readonly buildHierarchyId: (identity: string) => string;
  /** When true, real plan entries at this tier use buildHierarchyId as their node ID (containers). */
  readonly useHierarchyId?: boolean;
  /** Extract lateral references from entries at this tier.
   *  Each returned identity becomes a phantom leaf if not already in the graph. */
  readonly resolveLateralRefs?: (entry: PlanEntry) => readonly string[];
};

/** A complete hierarchy definition: root + ordered tiers from root-adjacent to leaf. */
type ChainSpec = {
  readonly rootId: string;
  readonly rootLabel: string;
  /** Tiers ordered from root-adjacent (index 0) to leaf (last index). */
  readonly tiers: readonly TierSpec[];
};

// ---------------------------------------------------------------------------
// Chain spec definitions
// ---------------------------------------------------------------------------

const UC_CHAIN: ChainSpec = {
  rootId: "uc-root",
  rootLabel: "Unity Catalog",
  tiers: [
    {
      name: "catalog",
      resourceTypes: CATALOG_TIER_TYPES,
      resolveIdentity: (entry) => extractStateField(entry, "name"),
      resolveParentRef: () => undefined, // root-adjacent
      buildHierarchyId: (name) => `catalog::${name}`,
      useHierarchyId: true,
    },
    {
      name: "schema",
      resourceTypes: SCHEMA_TIER_TYPES,
      resolveIdentity: (entry) => {
        const catalog = extractStateField(entry, "catalog_name");
        const name = extractStateField(entry, "name");
        return catalog !== undefined && name !== undefined ? `${catalog}.${name}` : undefined;
      },
      resolveParentRef: (entry) => extractStateField(entry, "catalog_name"),
      deriveParentRef: (identity) => identity.split(".")[0],
      buildHierarchyId: (identity) => `schema::${identity}`,
    },
    {
      name: "leaf",
      resourceTypes: new Set(["volumes", "registered_models", "synced_database_tables"]),
      resolveIdentity: () => undefined, // leaves are never parents
      resolveParentRef: (entry) => {
        const catalog = extractStateField(entry, "catalog_name");
        const schema = extractStateField(entry, "schema_name");
        if (schema !== undefined && catalog !== undefined) return `${catalog}.${schema}`;
        if (catalog !== undefined) return { identity: catalog, tierIndex: 0 };
        // Fall back to three-part name parsing (synced_database_tables)
        const name = extractStateField(entry, "name");
        if (name !== undefined) {
          const parsed = parseThreePartName(name);
          if (parsed !== undefined) return `${parsed.catalog}.${parsed.schema}`;
        }
        return undefined;
      },
      deriveParentRef: (identity) => {
        const parsed = parseThreePartName(identity);
        return parsed !== undefined ? `${parsed.catalog}.${parsed.schema}` : undefined;
      },
      buildHierarchyId: (identity) => `source-table::${identity}`,
      resolveLateralRefs: (entry) => {
        const name = extractSourceTableFullName(entry);
        if (name === undefined) return [];
        return parseThreePartName(name) !== undefined ? [name] : [];
      },
    },
  ],
};

/** Extract the last segment from a Databricks resource path (e.g., "projects/foo/branches/bar" → "bar"). */
const extractLastPathSegment = (resourcePath: string): string | undefined => {
  const segment = resourcePath.split("/").at(-1);
  return segment !== undefined && segment.length > 0 ? segment : undefined;
};

const POSTGRES_CHAIN: ChainSpec = {
  rootId: "postgres-root",
  rootLabel: "Lakebase",
  tiers: [
    {
      name: "project",
      resourceTypes: new Set(["postgres_projects"]),
      resolveIdentity: (entry) => extractStateField(entry, "project_id"),
      resolveParentRef: () => undefined, // root-adjacent
      buildHierarchyId: (name) => `postgres-project::${name}`,
      useHierarchyId: true,
    },
    {
      name: "branch",
      resourceTypes: new Set(["postgres_branches"]),
      resolveIdentity: (entry) => {
        const branchId = extractStateField(entry, "branch_id");
        if (branchId === undefined) return undefined;
        const parent = extractStateField(entry, "parent");
        const projectId = parent !== undefined ? extractLastPathSegment(parent) : undefined;
        return projectId !== undefined ? `${projectId}/${branchId}` : undefined;
      },
      resolveParentRef: (entry) => {
        const parent = extractStateField(entry, "parent");
        return parent !== undefined ? extractLastPathSegment(parent) : undefined;
      },
      deriveParentRef: (identity) => identity.split("/")[0],
      buildHierarchyId: (name) => `postgres-branch::${name}`,
    },
    {
      name: "endpoint",
      resourceTypes: new Set(["postgres_endpoints"]),
      resolveIdentity: () => undefined,
      resolveParentRef: (entry) => {
        const parent = extractStateField(entry, "parent");
        if (parent === undefined) return undefined;
        const segments = parent.split("/");
        // "projects/{project}/branches/{branch}" → "{project}/{branch}"
        if (segments.length >= 4 && segments[0] === "projects" && segments[2] === "branches") {
          return `${segments[1]}/${segments[3]}`;
        }
        return undefined;
      },
      deriveParentRef: undefined,
      buildHierarchyId: () => "",
    },
  ],
};

// ---------------------------------------------------------------------------
// Generic chain traversal
// ---------------------------------------------------------------------------

/** Index of real plan entries per tier: identity → nodeId. */
type TierIndex = ReadonlyMap<string, string>;

/** Build per-tier indexes mapping identity → node ID for real plan entries. */
const buildTierIndexes = (
  entries: readonly (readonly [string, PlanEntry])[],
  tiers: readonly TierSpec[],
): readonly TierIndex[] =>
  tiers.map((tier) => {
    const pairs: [string, string][] = [];
    for (const [key, entry] of entries) {
      const rt = extractResourceType(key);
      if (rt === undefined || !tier.resourceTypes.has(rt)) continue;
      const identity = tier.resolveIdentity(entry, key);
      if (identity === undefined) continue;
      const nodeId = tier.useHierarchyId === true ? tier.buildHierarchyId(identity) : key;
      pairs.push([identity, nodeId]);
    }
    return new Map(pairs);
  });

/**
 * Resolve a parent reference, creating phantom ancestors as needed.
 * Returns the node ID of the resolved parent (real node, phantom, or root).
 *
 * Walks up from `parentTierIndex` toward root, creating phantom nodes at each
 * tier where the referenced ancestor doesn't exist.
 */
const resolveParentChain = (
  identity: string,
  tierIndex: number,
  spec: ChainSpec,
  tierIndexes: readonly TierIndex[],
  phantomAccumulator: Map<string, PhantomGraphNode>,
  phantomEdgeAccumulator: (GraphEdge | undefined)[],
): string => {
  if (tierIndex < 0) return spec.rootId;

  // bounds check above guarantees these exist
  const tier = spec.tiers[tierIndex] as TierSpec;
  const index = tierIndexes[tierIndex] as TierIndex;

  // Real node exists at this tier → use it
  const existingNodeId = index.get(identity);
  if (existingNodeId !== undefined) return existingNodeId;

  // Create phantom — use last segment of identity as label (e.g. "missing" from "dagshund.missing")
  const phantomId = tier.buildHierarchyId(identity);
  if (!phantomAccumulator.has(phantomId)) {
    const segments = identity.split(/[./]/);
    const phantomLabel = segments[segments.length - 1] as string;
    phantomAccumulator.set(phantomId, buildPhantomNode(phantomId, phantomLabel));
  }

  // Top tier or can't derive parent → attach phantom to root
  const parentRef = tierIndex > 0 ? tier.deriveParentRef?.(identity) : undefined;
  if (parentRef === undefined) {
    phantomEdgeAccumulator.push(buildEdge(spec.rootId, phantomId));
    return phantomId;
  }

  // Recurse up to resolve (or create) the phantom's parent
  const grandparentNodeId = resolveParentChain(
    parentRef,
    tierIndex - 1,
    spec,
    tierIndexes,
    phantomAccumulator,
    phantomEdgeAccumulator,
  );
  phantomEdgeAccumulator.push(buildEdge(grandparentNodeId, phantomId));
  return phantomId;
};

/** Build a resource node for a plan entry and determine its effective ID in the hierarchy. */
const resolveEntryNode = (
  key: string,
  entry: PlanEntry,
  tier: TierSpec,
): { readonly node: ResourceGraphNode; readonly nodeId: string } => {
  if (tier.useHierarchyId === true) {
    const identity = tier.resolveIdentity(entry, key);
    if (identity !== undefined) {
      const hierarchyId = tier.buildHierarchyId(identity);
      return { node: buildContainerResourceNode(hierarchyId, key, entry), nodeId: hierarchyId };
    }
  }
  return { node: buildResourceNode(key, entry), nodeId: key };
};

/** Resolve the parent node ID for a resource entry within its hierarchy chain.
 *  Creates phantom ancestor nodes as needed via resolveParentChain. */
const resolveEntryParent = (
  key: string,
  entry: PlanEntry,
  tier: TierSpec,
  tierIndex: number,
  spec: ChainSpec,
  tierIndexes: readonly TierIndex[],
  phantomAccumulator: Map<string, PhantomGraphNode>,
  phantomEdgeAccumulator: (GraphEdge | undefined)[],
): string => {
  const rawParentRef = tier.resolveParentRef(entry, key);
  if (rawParentRef === undefined) return spec.rootId;

  const parentIdentity = typeof rawParentRef === "string" ? rawParentRef : rawParentRef.identity;
  const parentTier = typeof rawParentRef === "string" ? tierIndex - 1 : rawParentRef.tierIndex;

  return parentTier >= 0
    ? resolveParentChain(
        parentIdentity,
        parentTier,
        spec,
        tierIndexes,
        phantomAccumulator,
        phantomEdgeAccumulator,
      )
    : spec.rootId;
};

/**
 * Build a hierarchy subgraph from a chain spec.
 * Creates root + resource nodes + phantom ancestors + all hierarchy edges.
 */
const buildChainGraph = (
  entries: readonly (readonly [string, PlanEntry])[],
  spec: ChainSpec,
): PlanGraph => {
  if (entries.length === 0) return { nodes: [], edges: [] };

  const root = buildRootNode(spec.rootId, spec.rootLabel);
  const tierIndexes = buildTierIndexes(entries, spec.tiers);

  // Accumulators (local mutation within this pure function)
  const resourceNodes: ResourceGraphNode[] = [];
  const phantomNodes = new Map<string, PhantomGraphNode>();
  const phantomEdges: (GraphEdge | undefined)[] = [];
  const hierarchyEdges: (GraphEdge | undefined)[] = [];

  // Build resource nodes and resolve parent edges
  for (const [key, entry] of entries) {
    const rt = extractResourceType(key);
    if (rt === undefined) continue;

    const tierIndex = spec.tiers.findIndex((t) => t.resourceTypes.has(rt));
    if (tierIndex === -1) continue;
    const tier = spec.tiers[tierIndex] as TierSpec;

    const { node, nodeId } = resolveEntryNode(key, entry, tier);
    resourceNodes.push(node);

    const parentNodeId = resolveEntryParent(
      key,
      entry,
      tier,
      tierIndex,
      spec,
      tierIndexes,
      phantomNodes,
      phantomEdges,
    );
    hierarchyEdges.push(buildEdge(parentNodeId, nodeId, entryEdgeDiffState(entry)));
  }

  // Lateral refs: create phantom leaf nodes for referenced identities not already in the graph
  const leafTierIndex = spec.tiers.length - 1;
  const leafTier = spec.tiers[leafTierIndex];
  if (leafTier !== undefined && leafTier.resolveLateralRefs !== undefined) {
    // Build dedup set from real leaf-tier entry names (resolveIdentity returns undefined for leaves,
    // so tierIndexes won't contain them — collect three-part names directly)
    const realLeafNames = new Set<string>();
    for (const [key, entry] of entries) {
      const rt = extractResourceType(key);
      if (rt === undefined || !leafTier.resourceTypes.has(rt)) continue;
      const name = extractStateField(entry, "name");
      if (name !== undefined) realLeafNames.add(name);
    }

    const resolveLateral = leafTier.resolveLateralRefs;
    for (const [, entry] of entries) {
      for (const ref of resolveLateral(entry)) {
        if (realLeafNames.has(ref)) continue;
        const phantomId = resolveParentChain(
          ref,
          leafTierIndex,
          spec,
          tierIndexes,
          phantomNodes,
          phantomEdges,
        );
        // Edge from phantom's parent is created by resolveParentChain;
        // phantomId itself is the leaf phantom — no further edges needed
        void phantomId;
      }
    }
  }

  return {
    nodes: [root, ...resourceNodes, ...[...phantomNodes.values()]],
    edges: [...filterDefinedEdges(hierarchyEdges), ...filterDefinedEdges(phantomEdges)],
  };
};

// ---------------------------------------------------------------------------
// Workspace graph
// ---------------------------------------------------------------------------

/** Build the workspace subgraph: flat resources + Postgres hierarchy. */
const buildWorkspaceGraph = (
  workspaceEntries: readonly (readonly [string, PlanEntry])[],
  postgresEntries: readonly (readonly [string, PlanEntry])[],
): PlanGraph & { readonly flatParentId: string } => {
  const hasWorkspace = workspaceEntries.length > 0;
  const hasPostgres = postgresEntries.length > 0;

  if (!hasWorkspace && !hasPostgres)
    return { nodes: [], edges: [], flatParentId: "workspace-root" };

  const root = buildRootNode("workspace-root", "Workspace");

  // Postgres hierarchy
  const pgGraph = hasPostgres
    ? buildChainGraph(postgresEntries, POSTGRES_CHAIN)
    : { nodes: [], edges: [] };
  const pgRootEdge = hasPostgres
    ? filterDefinedEdges([buildEdge("workspace-root", "postgres-root")])
    : [];

  // Flat workspace resources — wrap in "Other Resources" group when hierarchies exist
  const wrapFlat = hasWorkspace && hasPostgres;
  const flatParentId = wrapFlat ? "other-resources-root" : "workspace-root";

  const flatNodes = workspaceEntries.map(([key, entry]) => buildResourceNode(key, entry));
  const flatEdges = filterDefinedEdges(
    workspaceEntries.map(([key, entry]) => buildEdge(flatParentId, key, entryEdgeDiffState(entry))),
  );
  const otherResourcesNodes = wrapFlat
    ? [buildRootNode("other-resources-root", "Other Resources")]
    : [];
  const otherResourcesEdge = wrapFlat
    ? filterDefinedEdges([buildEdge("workspace-root", "other-resources-root")])
    : [];

  return {
    nodes: [root, ...otherResourcesNodes, ...flatNodes, ...pgGraph.nodes],
    edges: [...otherResourcesEdge, ...flatEdges, ...pgRootEdge, ...pgGraph.edges],
    flatParentId,
  };
};

// ---------------------------------------------------------------------------
// Depends-on edges + deduplication
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Phantom database instances
// ---------------------------------------------------------------------------

/** Collect phantom nodes for database instances referenced by entries but absent from the plan.
 *  Uses `database-instance::` prefix following the phantom node ID convention. */
const collectPhantomDatabaseInstances = (
  entries: readonly (readonly [string, PlanEntry])[],
  existingResourceKeys: ReadonlySet<string>,
  parentId: string,
): { readonly nodes: readonly PhantomGraphNode[]; readonly edges: readonly GraphEdge[] } => {
  const phantomNames = new Set<string>();
  for (const [resourceKey, entry] of entries) {
    const rt = extractResourceType(resourceKey);
    if (rt === undefined || !DATABASE_INSTANCE_SOURCE_TYPES.has(rt)) continue;
    const name = extractStateField(entry, "database_instance_name");
    if (name === undefined) continue;
    const key = `resources.database_instances.${name}`;
    if (!existingResourceKeys.has(key)) phantomNames.add(name);
  }
  if (phantomNames.size === 0) return { nodes: [], edges: [] };
  // Inline construction instead of buildPhantomNode: resourceKey uses dot-path form
  // (not the :: prefixed id) so nodeIdByResourceKey can resolve it from lateral edge specs.
  const nodes: PhantomGraphNode[] = [...phantomNames].map((name) => ({
    id: `database-instance::${name}`,
    label: name,
    nodeKind: "phantom",
    diffState: "unchanged",
    resourceKey: `resources.database_instances.${name}`,
    changes: undefined,
    resourceState: undefined,
  }));
  const edges = filterDefinedEdges(nodes.map((n) => buildEdge(parentId, n.id)));
  return { nodes, edges };
};

// ---------------------------------------------------------------------------
// Main orchestrator
// ---------------------------------------------------------------------------

/** Build the complete resource graph for all plan entries. */
export const buildResourceGraph = (
  plan: Plan,
): PlanGraph & { readonly lateralEdges: readonly GraphEdge[] } => {
  const entries = Object.entries(plan.plan ?? {});

  if (entries.length === 0) return { nodes: [], edges: [], lateralEdges: [] };

  const ucEntries: [string, PlanEntry][] = [];
  const postgresEntries: [string, PlanEntry][] = [];
  const workspaceEntries: [string, PlanEntry][] = [];
  for (const entry of entries) {
    const resourceType = extractResourceType(entry[0]);
    if (resourceType !== undefined && isUnityCatalogType(resourceType)) {
      ucEntries.push(entry);
    } else if (resourceType !== undefined && isPostgresType(resourceType)) {
      postgresEntries.push(entry);
    } else {
      workspaceEntries.push(entry);
    }
  }

  const ucGraph = buildChainGraph(ucEntries, UC_CHAIN);
  const workspaceGraph = buildWorkspaceGraph(workspaceEntries, postgresEntries);
  const dependsOnEdges = collectDependsOnEdges(entries);

  const graphNodes = [...ucGraph.nodes, ...workspaceGraph.nodes];

  // Create phantom nodes for database instances referenced but not in the plan.
  // Parent to the same group as real flat workspace resources.
  const existingKeys = new Set(graphNodes.map((n) => n.resourceKey));
  const phantomDbInstances = collectPhantomDatabaseInstances(
    entries,
    existingKeys,
    workspaceGraph.flatParentId,
  );

  const allNodes = [...graphNodes, ...phantomDbInstances.nodes];

  // Build lookup maps for lateral edge extraction
  const nodeIdByResourceKey = new Map<string, string>(allNodes.map((n) => [n.resourceKey, n.id]));
  const nodeIds = new Set<string>(allNodes.map((n) => n.id));

  const lateralEdges = extractLateralEdges({ entries, nodeIdByResourceKey, nodeIds });

  return {
    nodes: allNodes,
    edges: deduplicateEdges([
      ...ucGraph.edges,
      ...workspaceGraph.edges,
      ...dependsOnEdges,
      ...phantomDbInstances.edges,
    ]),
    lateralEdges,
  };
};
