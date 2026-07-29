import { mapActionToDiffState } from "../parser/map-diff-state.ts";
import {
  buildEdge,
  buildHierarchyGraphNode,
  type DerivedGraphNode,
  filterDefinedEdges,
  type GraphEdge,
  type PhantomGraphNode,
  type PlanGraph,
  type ResourceGraphNode,
  toEdgeDiffState,
} from "../types/graph-types.ts";
import type { Plan, PlanEntry } from "../types/plan-schema.ts";
import { type NormalizedEntry, normalizePlan } from "../utils/normalize-plan.ts";
import {
  buildPrefixedNodeId,
  buildResourceKey,
  extractPhantomResourceType,
  extractResourceName,
  extractResourceType,
  type PhantomKind,
} from "../utils/resource-key.ts";
import { hasAnyDriftWithContext, hasFieldDrift } from "../utils/structural-diff.ts";
import { filterJobLevelChanges } from "../utils/task-key.ts";
import { getUnknownProp } from "../utils/unknown-record.ts";
import { buildTaskChangeSummary } from "./build-task-change-summary.ts";
import {
  buildOrphanEffectPhantoms,
  collectPhantomAppDependencies,
  collectPhantomDatabaseInstances,
  collectPhantomExternalRefs,
} from "./collect-phantom-nodes.ts";
import {
  buildDerivedNodeId,
  buildDerivedReferenceIndex,
  type DerivedNodeRef,
  extractDerivedNodeLabel,
  extractDerivedNodeRefs,
  extractDerivedPlacement,
  extractPromotedPhantomKind,
} from "./derived-node-specs.ts";
import { extractLateralEdges } from "./extract-lateral-edges.ts";
import {
  extractResourceState,
  extractServedEntities,
  extractSourceTableFullName,
  extractStateField,
  parseThreePartName,
} from "./extract-resource-state.ts";
import { resolveJobState, resolveTaskEntries, type TaskEntry } from "./extract-tasks.ts";
import {
  extractBundleResourceIdRef,
  formatPostgresBranchIdentity,
  parsePostgresBranchPath,
  parsePostgresProjectPath,
  resolvePostgresBranchIdentity,
  resolvePostgresBranchRefIdentity,
  resolvePostgresBranchRefIdentityFromEntries,
  resolvePostgresDatabaseIdentity,
  resolvePostgresDatabaseResourceKey,
} from "./postgres-paths.ts";
import {
  buildApiIdIndex,
  extractAppResourceReferences,
  extractGenieSpaceApiId,
  extractJobApiId,
  type ReferenceIndexes,
} from "./reference-specs.ts";
import { buildJobIdMap } from "./resolve-run-job-target.ts";

// ---------------------------------------------------------------------------
// Type classification sets
// ---------------------------------------------------------------------------

/** Catalog-tier types — direct children of uc-root. */
const CATALOG_TIER_TYPES: ReadonlySet<string> = new Set([
  "catalogs",
  "database_catalogs",
  "postgres_catalogs",
]);

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
  "postgres_databases",
  "postgres_endpoints",
  "postgres_roles",
  "postgres_synced_tables",
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
) => {
  const resourceHasShapeDrift = hasFieldDrift(entry.changes);
  const driftParent = {
    newState: entry.new_state,
    remoteState: entry.remote_state,
    resourceHasShapeDrift,
  };
  return {
    label: extractResourceName(resourceKey),
    diffState: mapActionToDiffState(entry.action),
    changes: filterJobLevelChanges(entry.changes),
    resourceState: resolveJobState(entry.new_state, entry.remote_state),
    newState: entry.new_state,
    remoteState: entry.remote_state,
    resourceHasShapeDrift,
    taskChangeSummary: buildTaskChangeSummary(tasks, entry.action, entry.changes, driftParent),
    // Scanned against raw `entry.changes` — `filterJobLevelChanges` above strips
    // the `tasks[...]` entries that carry whole-task drift, so the scan must
    // happen here before the filter can hide the signal.
    isDrift: hasAnyDriftWithContext(entry.changes, driftParent),
  };
};

/** Build a GraphNode for a real plan resource entry. Container-tier resources
 *  (catalogs, projects) pass a hierarchy override for the node ID and label. */
const buildResourceNode = (
  key: string,
  entry: NormalizedEntry,
  hierarchy?: { readonly id: string; readonly label?: string },
): ResourceGraphNode => {
  if (isJobEntry(key)) {
    const tasks = resolveTaskEntries(entry.new_state, entry.remote_state);
    return {
      id: key,
      nodeKind: "resource",
      resourceKey: key,
      effects: entry.effects,
      ...buildJobFields(key, entry, tasks),
    };
  }
  const resourceHasShapeDrift = hasFieldDrift(entry.changes);
  return {
    id: hierarchy?.id ?? key,
    label: hierarchy?.label ?? extractResourceName(key),
    nodeKind: "resource",
    diffState: mapActionToDiffState(entry.action),
    resourceKey: key,
    changes: entry.changes,
    resourceState: extractResourceState(entry),
    newState: entry.new_state,
    remoteState: entry.remote_state,
    resourceHasShapeDrift,
    taskChangeSummary: undefined,
    isDrift: hasAnyDriftWithContext(entry.changes, {
      newState: entry.new_state,
      remoteState: entry.remote_state,
      resourceHasShapeDrift,
    }),
  };
};

const buildDerivedNode = (
  ownerResourceKey: string,
  ownerEntry: PlanEntry,
  ref: DerivedNodeRef,
): DerivedGraphNode => {
  const id = buildDerivedNodeId(ref.derivedKind, ref.identity);
  return {
    id,
    label: extractDerivedNodeLabel(ref.derivedKind, ownerResourceKey, ref.identity),
    nodeKind: "derived",
    derivedKind: ref.derivedKind,
    ownerResourceKey,
    diffState: mapActionToDiffState(ownerEntry.action),
    resourceKey: id,
    changes: undefined,
    resourceState: undefined,
    newState: undefined,
    remoteState: undefined,
    resourceHasShapeDrift: false,
  };
};

/** Keep the first item for an ID when multiple builders/collectors produce it. */
const dedupeById = <T extends { readonly id: string }>(items: readonly T[]): readonly T[] => {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) {
      return false;
    }
    seen.add(item.id);
    return true;
  });
};

// ---------------------------------------------------------------------------
// Edge helpers
// ---------------------------------------------------------------------------

/** Map an entry's action to an edge diff state. */
const resolveEntryEdgeDiffState = (entry: PlanEntry) =>
  toEdgeDiffState(mapActionToDiffState(entry.action));

// ---------------------------------------------------------------------------
// Chain spec types
// ---------------------------------------------------------------------------

/**
 * Return type for resolveParentRef:
 * - parent-identity: identity at the tier immediately above (tier - 1)
 * - tier-identity: identity at a specific tier (for skipping tiers, e.g. volume → catalog)
 * - resource-key: semantic bundle resource-id ref to a real node at a specific tier
 */
type ParentRef =
  | { readonly kind: "parent-identity"; readonly identity: string }
  | { readonly kind: "tier-identity"; readonly identity: string; readonly tierIndex: number }
  | { readonly kind: "resource-key"; readonly resourceKey: string; readonly tierIndex: number };

const parentIdentityRef = (identity: string | undefined): ParentRef | undefined =>
  identity !== undefined ? { kind: "parent-identity", identity } : undefined;

const tierIdentityRef = (identity: string, tierIndex: number): ParentRef => ({
  kind: "tier-identity",
  identity,
  tierIndex,
});

const resourceKeyRef = (resourceKey: string, tierIndex: number): ParentRef => ({
  kind: "resource-key",
  resourceKey,
  tierIndex,
});

/** A single tier in a hierarchy chain (e.g. catalog, schema, project, branch). */
type TierSpec = {
  /** Human-readable name — used for badges and labels. */
  readonly name: string;
  /** Plan resource types that sit at this tier. */
  readonly resourceTypes: ReadonlySet<string>;
  /** Extract this node's identity (the key children use to reference it). */
  readonly resolveIdentity: (
    entry: PlanEntry,
    key: string,
    entries: readonly (readonly [string, PlanEntry])[],
  ) => string | undefined;
  /** Extract the parent's identity at the tier above. Returns string for tier-1, object for a specific tier. */
  readonly resolveParentRef: (
    entry: PlanEntry,
    key: string,
    entries: readonly (readonly [string, PlanEntry])[],
  ) => ParentRef | undefined;
  /** Derive a phantom's parent identity from its own identity (for upward chain propagation). */
  readonly deriveParentRef?: (identity: string) => string | undefined;
  /** Build the node ID for this tier (used by both real container nodes and phantoms). */
  readonly buildHierarchyId: (identity: string) => string;
  /** When true, real plan entries at this tier use buildHierarchyId as their node ID (containers). */
  readonly useHierarchyId?: boolean;
  /** Extract semantic references that may need phantom nodes before lateral edges are built. */
  readonly resolveMissingHierarchyRefs?: (entry: PlanEntry) => readonly string[];
  /** Phantom kind created for missing hierarchy refs, used for compatible derived promotion. */
  readonly missingHierarchyRefPhantomKind?: PhantomKind;
};

/** A complete hierarchy definition: root + ordered tiers from root-adjacent to leaf. */
type ChainSpec = {
  readonly rootId: string;
  readonly rootLabel: string;
  /** Tiers ordered from root-adjacent (index 0) to leaf (last index). */
  readonly tiers: readonly TierSpec[];
};

/** A pre-extracted phantom leaf reference from a non-hierarchy entry (e.g. serving endpoint, quality monitor).
 *  Allows workspace entries to inject phantom leaves into a hierarchy chain with custom IDs. */
type ExternalLeafPhantomRef = {
  /** Three-part name identity (e.g. "dagshund.phantom_schema.phantom_model"). */
  readonly identity: string;
  /** Custom phantom node ID (e.g. "registered-model::dagshund.phantom_schema.phantom_model"). */
  readonly phantomId: string;
  /** Display label (e.g. "phantom_model"). */
  readonly label: string;
  readonly phantomKind: PhantomKind;
};

type ExternalHierarchyRef = {
  readonly identity: string;
  readonly tierIndex: number;
};

type ExternalDerivedLeafRef = {
  readonly identity: string;
  readonly node: DerivedGraphNode;
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
      resolveIdentity: (entry, key) =>
        extractResourceType(key) === "postgres_catalogs"
          ? extractStateField(entry, "catalog_id")
          : extractStateField(entry, "name"),
      resolveParentRef: () => undefined, // root-adjacent
      buildHierarchyId: (name) => buildPrefixedNodeId("catalog", name),
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
      resolveParentRef: (entry) => parentIdentityRef(extractStateField(entry, "catalog_name")),
      deriveParentRef: (identity) => identity.split(".")[0],
      buildHierarchyId: (identity) => buildPrefixedNodeId("schema", identity),
    },
    {
      name: "leaf",
      resourceTypes: new Set(["volumes", "registered_models", "synced_database_tables"]),
      resolveIdentity: () => undefined, // leaves are never parents
      resolveParentRef: (entry) => {
        const catalog = extractStateField(entry, "catalog_name");
        const schema = extractStateField(entry, "schema_name");
        if (schema !== undefined && catalog !== undefined)
          return parentIdentityRef(`${catalog}.${schema}`);
        if (catalog !== undefined) return tierIdentityRef(catalog, 0);
        // Fall back to three-part name parsing (synced_database_tables)
        const name = extractStateField(entry, "name");
        if (name !== undefined) {
          const parsed = parseThreePartName(name);
          if (parsed !== undefined) return parentIdentityRef(`${parsed.catalog}.${parsed.schema}`);
        }
        return undefined;
      },
      deriveParentRef: (identity) => {
        const parsed = parseThreePartName(identity);
        return parsed !== undefined ? `${parsed.catalog}.${parsed.schema}` : undefined;
      },
      buildHierarchyId: (identity) => buildPrefixedNodeId("sourceTable", identity),
      resolveMissingHierarchyRefs: (entry) => {
        const name = extractSourceTableFullName(entry);
        if (name === undefined) return [];
        return parseThreePartName(name) !== undefined ? [name] : [];
      },
      missingHierarchyRefPhantomKind: "sourceTable",
    },
  ],
};

const resolvePostgresProjectParentRef = (parent: string): ParentRef | undefined => {
  const resourceKey = extractBundleResourceIdRef(parent);
  if (resourceKey !== undefined) {
    return extractResourceType(resourceKey) === "postgres_projects"
      ? resourceKeyRef(resourceKey, 0)
      : undefined;
  }
  return parentIdentityRef(parsePostgresProjectPath(parent));
};

const resolvePostgresBranchParentRef = (parent: string): ParentRef | undefined => {
  const resourceKey = extractBundleResourceIdRef(parent);
  if (resourceKey !== undefined) {
    return extractResourceType(resourceKey) === "postgres_branches"
      ? resourceKeyRef(resourceKey, 1)
      : undefined;
  }
  const branchPath = parsePostgresBranchPath(parent);
  return branchPath !== undefined
    ? parentIdentityRef(formatPostgresBranchIdentity(branchPath))
    : undefined;
};

const resolvePostgresBranchChildParentRef = (entry: PlanEntry): ParentRef | undefined => {
  const parent = extractStateField(entry, "parent") ?? extractStateField(entry, "branch");
  return parent !== undefined ? resolvePostgresBranchParentRef(parent) : undefined;
};

const resolvePostgresDatabaseParentRef = (
  entry: PlanEntry,
  entries: readonly (readonly [string, PlanEntry])[],
): ParentRef | undefined => {
  const branch = extractStateField(entry, "branch");
  const postgresDatabase = extractStateField(entry, "postgres_database");
  if (branch === undefined || postgresDatabase === undefined) return undefined;

  const targetKey = resolvePostgresDatabaseResourceKey(branch, postgresDatabase, entries);
  if (targetKey !== undefined) return resourceKeyRef(targetKey, 2);

  const branchIdentity = resolvePostgresBranchRefIdentityFromEntries(branch, entries);
  return branchIdentity !== undefined
    ? tierIdentityRef(`${branchIdentity}/${postgresDatabase}`, 2)
    : undefined;
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
      buildHierarchyId: (name) => buildPrefixedNodeId("postgresProject", name),
      useHierarchyId: true,
    },
    {
      name: "branch",
      resourceTypes: new Set(["postgres_branches"]),
      resolveIdentity: (entry) => resolvePostgresBranchIdentity(entry),
      resolveParentRef: (entry) => {
        const parent = extractStateField(entry, "parent");
        return parent !== undefined ? resolvePostgresProjectParentRef(parent) : undefined;
      },
      deriveParentRef: (identity) => identity.split("/")[0],
      buildHierarchyId: (name) => buildPrefixedNodeId("postgresBranch", name),
      resolveMissingHierarchyRefs: (entry) => {
        const sourceBranch = extractStateField(entry, "source_branch");
        if (sourceBranch === undefined) return [];
        const identity = resolvePostgresBranchRefIdentity(sourceBranch);
        return identity !== undefined ? [identity] : [];
      },
    },
    {
      name: "branch child",
      resourceTypes: new Set(["postgres_databases", "postgres_endpoints", "postgres_roles"]),
      resolveIdentity: (entry, key, entries) =>
        extractResourceType(key) === "postgres_databases"
          ? resolvePostgresDatabaseIdentity(entry, entries)
          : undefined,
      resolveParentRef: (entry) => resolvePostgresBranchChildParentRef(entry),
      deriveParentRef: (identity) => identity.split("/").slice(0, 2).join("/"),
      buildHierarchyId: (identity) => buildPrefixedNodeId("postgresDatabase", identity),
    },
    {
      name: "database child",
      resourceTypes: new Set(["postgres_synced_tables"]),
      resolveIdentity: () => undefined,
      resolveParentRef: (entry, _key, entries) => resolvePostgresDatabaseParentRef(entry, entries),
      buildHierarchyId: () => "",
    },
  ],
};

const POSTGRES_DATABASE_TIER_INDEX = 2;

// ---------------------------------------------------------------------------
// Generic chain traversal
// ---------------------------------------------------------------------------

/** Index of real plan entries per tier for semantic parent resolution. */
type TierIndex = {
  readonly byIdentity: ReadonlyMap<string, string>;
  readonly byResourceKey: ReadonlyMap<string, string>;
};

/** Build per-tier indexes mapping identity → node ID for real plan entries. */
const buildTierIndexes = (
  entries: readonly (readonly [string, PlanEntry])[],
  tiers: readonly TierSpec[],
): readonly TierIndex[] =>
  tiers.map((tier) => {
    const identityPairs: [string, string][] = [];
    const resourceKeyPairs: [string, string][] = [];
    for (const [key, entry] of entries) {
      const resourceType = extractResourceType(key);
      if (resourceType === undefined || !tier.resourceTypes.has(resourceType)) continue;
      const identity = tier.resolveIdentity(entry, key, entries);
      const nodeId =
        tier.useHierarchyId === true && identity !== undefined
          ? tier.buildHierarchyId(identity)
          : key;
      resourceKeyPairs.push([key, nodeId]);
      if (identity !== undefined) identityPairs.push([identity, nodeId]);
    }
    return { byIdentity: new Map(identityPairs), byResourceKey: new Map(resourceKeyPairs) };
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

  const tier = spec.tiers[tierIndex];
  const index = tierIndexes[tierIndex];
  if (tier === undefined || index === undefined) return spec.rootId;

  // Real node exists at this tier → use it
  const existingNodeId = index.byIdentity.get(identity);
  if (existingNodeId !== undefined) return existingNodeId;

  // Create phantom — use last segment of identity as label (e.g. "missing" from "dagshund.missing")
  const phantomId = tier.buildHierarchyId(identity);
  if (!phantomAccumulator.has(phantomId)) {
    const phantomLabel = identity.split(/[./]/).at(-1) ?? identity;
    phantomAccumulator.set(phantomId, buildHierarchyGraphNode("phantom", phantomId, phantomLabel));
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
  entries: readonly (readonly [string, PlanEntry])[],
): { readonly node: ResourceGraphNode; readonly nodeId: string } => {
  if (tier.useHierarchyId === true) {
    const identity = tier.resolveIdentity(entry, key, entries);
    if (identity !== undefined) {
      const hierarchyId = tier.buildHierarchyId(identity);
      const label = extractResourceType(key) === "postgres_catalogs" ? identity : undefined;
      return {
        node: buildResourceNode(key, entry, { id: hierarchyId, label }),
        nodeId: hierarchyId,
      };
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
  entries: readonly (readonly [string, PlanEntry])[],
  phantomAccumulator: Map<string, PhantomGraphNode>,
  phantomEdgeAccumulator: (GraphEdge | undefined)[],
): string => {
  const rawParentRef = tier.resolveParentRef(entry, key, entries);
  if (rawParentRef === undefined) return spec.rootId;

  if (rawParentRef.kind === "resource-key") {
    const parentIndex = tierIndexes[rawParentRef.tierIndex];
    return parentIndex?.byResourceKey.get(rawParentRef.resourceKey) ?? spec.rootId;
  }

  const parentTier =
    rawParentRef.kind === "parent-identity" ? tierIndex - 1 : rawParentRef.tierIndex;

  return parentTier >= 0
    ? resolveParentChain(
        rawParentRef.identity,
        parentTier,
        spec,
        tierIndexes,
        phantomAccumulator,
        phantomEdgeAccumulator,
      )
    : spec.rootId;
};

const collectPromotedPhantomIdentities = (
  refs: readonly ExternalDerivedLeafRef[],
): ReadonlyMap<PhantomKind, ReadonlySet<string>> => {
  const identitiesByKind = new Map<PhantomKind, Set<string>>();
  for (const ref of refs) {
    const phantomKind = extractPromotedPhantomKind(ref.node.derivedKind);
    if (phantomKind === undefined) continue;
    const identities = identitiesByKind.get(phantomKind) ?? new Set<string>();
    identities.add(ref.identity);
    identitiesByKind.set(phantomKind, identities);
  }
  return identitiesByKind;
};

const isPromotedPhantomIdentity = (
  identitiesByKind: ReadonlyMap<PhantomKind, ReadonlySet<string>>,
  phantomKind: PhantomKind | undefined,
  identity: string,
): boolean =>
  phantomKind !== undefined && (identitiesByKind.get(phantomKind)?.has(identity) ?? false);

/**
 * Build a hierarchy subgraph from a chain spec.
 * Creates root + resource nodes + phantom ancestors + all hierarchy edges.
 */
const buildChainGraph = (
  entries: readonly (readonly [string, PlanEntry])[],
  spec: ChainSpec,
  externalLeafPhantomRefs?: readonly ExternalLeafPhantomRef[],
  externalHierarchyRefs?: readonly ExternalHierarchyRef[],
  externalDerivedLeafRefs?: readonly ExternalDerivedLeafRef[],
): PlanGraph => {
  const hasExternalRefs =
    (externalLeafPhantomRefs !== undefined && externalLeafPhantomRefs.length > 0) ||
    (externalHierarchyRefs !== undefined && externalHierarchyRefs.length > 0) ||
    (externalDerivedLeafRefs !== undefined && externalDerivedLeafRefs.length > 0);
  if (entries.length === 0 && !hasExternalRefs) return { nodes: [], edges: [] };

  const root = buildHierarchyGraphNode("root", spec.rootId, spec.rootLabel);
  const tierIndexes = buildTierIndexes(entries, spec.tiers);
  const promotedPhantomIdentities = collectPromotedPhantomIdentities(externalDerivedLeafRefs ?? []);

  // Accumulators (local mutation within this pure function)
  const resourceNodes: ResourceGraphNode[] = [];
  const derivedNodes = new Map<string, DerivedGraphNode>();
  const phantomNodes = new Map<string, PhantomGraphNode>();
  const phantomEdges: (GraphEdge | undefined)[] = [];
  const hierarchyEdges: (GraphEdge | undefined)[] = [];

  // Build resource nodes and resolve parent edges
  for (const [key, entry] of entries) {
    const resourceType = extractResourceType(key);
    if (resourceType === undefined) continue;

    const tierIndex = spec.tiers.findIndex((tier) => tier.resourceTypes.has(resourceType));
    if (tierIndex === -1) continue;
    const tier = spec.tiers[tierIndex];
    if (tier === undefined) continue;

    const { node, nodeId } = resolveEntryNode(key, entry, tier, entries);
    resourceNodes.push(node);

    const parentNodeId = resolveEntryParent(
      key,
      entry,
      tier,
      tierIndex,
      spec,
      tierIndexes,
      entries,
      phantomNodes,
      phantomEdges,
    );
    hierarchyEdges.push(buildEdge(parentNodeId, nodeId, resolveEntryEdgeDiffState(entry)));
  }

  // Missing hierarchy refs create phantom targets before lateral edge extraction runs.
  for (const [referencedTierIndex, referencedTier] of spec.tiers.entries()) {
    if (referencedTier.resolveMissingHierarchyRefs === undefined) continue;
    const realNames = new Set<string>();
    for (const [key, entry] of entries) {
      const resourceType = extractResourceType(key);
      if (resourceType === undefined || !referencedTier.resourceTypes.has(resourceType)) continue;
      const identity =
        referencedTier.resolveIdentity(entry, key, entries) ?? extractStateField(entry, "name");
      if (identity !== undefined) realNames.add(identity);
    }

    const resolveMissingHierarchyRefs = referencedTier.resolveMissingHierarchyRefs;
    for (const [, entry] of entries) {
      for (const ref of resolveMissingHierarchyRefs(entry)) {
        if (
          realNames.has(ref) ||
          isPromotedPhantomIdentity(
            promotedPhantomIdentities,
            referencedTier.missingHierarchyRefPhantomKind,
            ref,
          )
        ) {
          continue;
        }
        const phantomId = resolveParentChain(
          ref,
          referencedTierIndex,
          spec,
          tierIndexes,
          phantomNodes,
          phantomEdges,
        );
        // Edge from phantom's parent is created by resolveParentChain.
        void phantomId;
      }
    }
  }

  if (externalHierarchyRefs !== undefined && externalHierarchyRefs.length > 0) {
    for (const ref of externalHierarchyRefs) {
      resolveParentChain(
        ref.identity,
        ref.tierIndex,
        spec,
        tierIndexes,
        phantomNodes,
        phantomEdges,
      );
    }
  }

  // Plan entries that reference external three-part UC names inject phantom leaves
  // into the UC hierarchy with reference-specific IDs.
  if (externalLeafPhantomRefs !== undefined && externalLeafPhantomRefs.length > 0) {
    const schemaTierIndex = spec.tiers.length - 2; // schema is one above leaf
    for (const { identity, phantomId, label, phantomKind } of externalLeafPhantomRefs) {
      if (
        isPromotedPhantomIdentity(promotedPhantomIdentities, phantomKind, identity) ||
        phantomNodes.has(phantomId)
      ) {
        continue;
      }
      const parsed = parseThreePartName(identity);
      if (parsed === undefined) continue;

      // Resolve (or create) phantom ancestors up through the schema tier
      const schemaIdentity = `${parsed.catalog}.${parsed.schema}`;
      const parentNodeId = resolveParentChain(
        schemaIdentity,
        schemaTierIndex,
        spec,
        tierIndexes,
        phantomNodes,
        phantomEdges,
      );

      // Create the leaf phantom with its custom ID and wire to schema parent
      phantomNodes.set(phantomId, buildHierarchyGraphNode("phantom", phantomId, label));
      phantomEdges.push(buildEdge(parentNodeId, phantomId));
    }
  }

  if (externalDerivedLeafRefs !== undefined && externalDerivedLeafRefs.length > 0) {
    const schemaTierIndex = spec.tiers.length - 2;
    for (const { identity, node } of externalDerivedLeafRefs) {
      if (derivedNodes.has(node.id)) continue;
      const parsed = parseThreePartName(identity);
      if (parsed === undefined) continue;
      const parentNodeId = resolveParentChain(
        `${parsed.catalog}.${parsed.schema}`,
        schemaTierIndex,
        spec,
        tierIndexes,
        phantomNodes,
        phantomEdges,
      );
      derivedNodes.set(node.id, node);
      hierarchyEdges.push(buildEdge(parentNodeId, node.id, toEdgeDiffState(node.diffState)));
    }
  }

  return {
    nodes: [root, ...resourceNodes, ...derivedNodes.values(), ...phantomNodes.values()],
    edges: [...filterDefinedEdges(hierarchyEdges), ...filterDefinedEdges(phantomEdges)],
  };
};

// ---------------------------------------------------------------------------
// Workspace graph
// ---------------------------------------------------------------------------

const WORKSPACE_ROOT_ID = "workspace-root";
const OTHER_RESOURCES_ROOT_ID = "other-resources-root";
const WORKSPACE_CATEGORY_PREFIX = "workspace-category::";

const buildWorkspaceCategoryId = (resourceType: string): string =>
  `${WORKSPACE_CATEGORY_PREFIX}${resourceType}`;

const formatWorkspaceCategoryLabel = (resourceType: string): string =>
  resourceType
    .split("_")
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(" ");

type WorkspacePlacement = {
  readonly categoryTypes: ReadonlySet<string>;
  readonly fallbackParentId: string;
};

type WorkspaceGraphResult = {
  readonly graph: PlanGraph;
  readonly placement: WorkspacePlacement;
};

type WorkspaceDerivedNodeRef = {
  readonly resourceType: string;
  readonly node: DerivedGraphNode;
};

const collectRepeatedWorkspaceTypes = (
  entries: readonly (readonly [string, PlanEntry])[],
  derivedRefs: readonly WorkspaceDerivedNodeRef[],
): ReadonlySet<string> => {
  const counts = new Map<string, number>();
  const resourceTypes = [
    ...entries.map(([key]) => extractResourceType(key)),
    ...derivedRefs.map((ref) => ref.resourceType),
  ];
  for (const resourceType of resourceTypes) {
    if (resourceType !== undefined) counts.set(resourceType, (counts.get(resourceType) ?? 0) + 1);
  }
  return new Set(
    [...counts].filter(([, count]) => count > 1).map(([resourceType]) => resourceType),
  );
};

const buildWorkspacePlacement = (
  entries: readonly (readonly [string, PlanEntry])[],
  derivedRefs: readonly WorkspaceDerivedNodeRef[],
  hasPostgres: boolean,
): WorkspacePlacement => {
  const categoryTypes = collectRepeatedWorkspaceTypes(entries, derivedRefs);
  const fallbackParentId =
    categoryTypes.size > 0 || hasPostgres ? OTHER_RESOURCES_ROOT_ID : WORKSPACE_ROOT_ID;
  return { categoryTypes, fallbackParentId };
};

const resolveWorkspaceTypeParentId = (
  resourceType: string | undefined,
  placement: WorkspacePlacement,
): string =>
  resourceType !== undefined && placement.categoryTypes.has(resourceType)
    ? buildWorkspaceCategoryId(resourceType)
    : placement.fallbackParentId;

const buildWorkspaceCategoryGraph = (resourceTypes: ReadonlySet<string>): PlanGraph => {
  const sortedTypes = [...resourceTypes].toSorted();
  const nodes = sortedTypes.map((resourceType) =>
    buildHierarchyGraphNode(
      "root",
      buildWorkspaceCategoryId(resourceType),
      formatWorkspaceCategoryLabel(resourceType),
    ),
  );
  const edges = sortedTypes.map((resourceType) =>
    buildEdge(WORKSPACE_ROOT_ID, buildWorkspaceCategoryId(resourceType)),
  );
  return { nodes, edges: filterDefinedEdges(edges) };
};

const buildFlatWorkspaceGraph = (
  entries: readonly (readonly [string, PlanEntry])[],
  placement: WorkspacePlacement,
): PlanGraph => {
  const categories = buildWorkspaceCategoryGraph(placement.categoryTypes);
  const nodes = entries.map(([key, entry]) => buildResourceNode(key, entry));
  const edges = entries.map(([key, entry]) =>
    buildEdge(
      resolveWorkspaceTypeParentId(extractResourceType(key), placement),
      key,
      resolveEntryEdgeDiffState(entry),
    ),
  );
  return {
    nodes: [...categories.nodes, ...nodes],
    edges: [...categories.edges, ...filterDefinedEdges(edges)],
  };
};

const buildWorkspaceDerivedGraph = (
  refs: readonly WorkspaceDerivedNodeRef[],
  placement: WorkspacePlacement,
): PlanGraph => ({
  nodes: refs.map((ref) => ref.node),
  edges: filterDefinedEdges(
    refs.map((ref) =>
      buildEdge(
        resolveWorkspaceTypeParentId(ref.resourceType, placement),
        ref.node.id,
        toEdgeDiffState(ref.node.diffState),
      ),
    ),
  ),
});

const buildWorkspacePhantomGraph = (
  nodes: readonly PhantomGraphNode[],
  placement: WorkspacePlacement,
): PlanGraph => ({
  nodes,
  edges: filterDefinedEdges(
    nodes.map((node) =>
      buildEdge(
        resolveWorkspaceTypeParentId(extractPhantomResourceType(node.id), placement),
        node.id,
      ),
    ),
  ),
});

const buildOtherResourcesGraph = (graphs: readonly PlanGraph[]): PlanGraph => {
  const hasOtherResources = graphs.some((graph) =>
    graph.edges.some((edge) => edge.source === OTHER_RESOURCES_ROOT_ID),
  );
  if (!hasOtherResources) return { nodes: [], edges: [] };
  return {
    nodes: [buildHierarchyGraphNode("root", OTHER_RESOURCES_ROOT_ID, "Other Resources")],
    edges: filterDefinedEdges([buildEdge(WORKSPACE_ROOT_ID, OTHER_RESOURCES_ROOT_ID)]),
  };
};

/** Build the workspace subgraph: grouped flat resources + Postgres hierarchy. */
const buildWorkspaceGraph = (
  workspaceEntries: readonly (readonly [string, PlanEntry])[],
  postgresEntries: readonly (readonly [string, PlanEntry])[],
  externalPostgresHierarchyRefs: readonly ExternalHierarchyRef[],
  derivedRefs: readonly WorkspaceDerivedNodeRef[],
): WorkspaceGraphResult => {
  const hasWorkspace = workspaceEntries.length > 0 || derivedRefs.length > 0;
  const hasPostgres = postgresEntries.length > 0 || externalPostgresHierarchyRefs.length > 0;
  const placement = buildWorkspacePlacement(workspaceEntries, derivedRefs, hasPostgres);

  if (!hasWorkspace && !hasPostgres) return { graph: { nodes: [], edges: [] }, placement };

  const root = buildHierarchyGraphNode("root", WORKSPACE_ROOT_ID, "Workspace");
  const workspaceGraph = buildFlatWorkspaceGraph(workspaceEntries, placement);
  const derivedGraph = buildWorkspaceDerivedGraph(derivedRefs, placement);
  const postgresGraph = hasPostgres
    ? buildChainGraph(postgresEntries, POSTGRES_CHAIN, undefined, externalPostgresHierarchyRefs)
    : { nodes: [], edges: [] };
  const postgresRootEdge = hasPostgres
    ? filterDefinedEdges([buildEdge(WORKSPACE_ROOT_ID, "postgres-root")])
    : [];

  return {
    graph: {
      nodes: [root, ...workspaceGraph.nodes, ...derivedGraph.nodes, ...postgresGraph.nodes],
      edges: [
        ...workspaceGraph.edges,
        ...derivedGraph.edges,
        ...postgresRootEdge,
        ...postgresGraph.edges,
      ],
    },
    placement,
  };
};

// ---------------------------------------------------------------------------
// External UC leaf refs
// ---------------------------------------------------------------------------

const collectExternalDerivedLeafRefs = (
  entries: readonly (readonly [string, PlanEntry])[],
): readonly ExternalDerivedLeafRef[] =>
  entries.flatMap(([ownerResourceKey, ownerEntry]) =>
    extractDerivedNodeRefs(ownerResourceKey, ownerEntry).flatMap((ref) =>
      extractDerivedPlacement(ref.derivedKind).kind === "ucLeaf"
        ? [
            {
              identity: ref.identity,
              node: buildDerivedNode(ownerResourceKey, ownerEntry, ref),
            },
          ]
        : [],
    ),
  );

const collectWorkspaceDerivedNodeRefs = (
  entries: readonly (readonly [string, PlanEntry])[],
): readonly WorkspaceDerivedNodeRef[] =>
  entries.flatMap(([ownerResourceKey, ownerEntry]) =>
    extractDerivedNodeRefs(ownerResourceKey, ownerEntry).flatMap((ref) => {
      const placement = extractDerivedPlacement(ref.derivedKind);
      return placement.kind === "workspace"
        ? [
            {
              resourceType: placement.resourceType,
              node: buildDerivedNode(ownerResourceKey, ownerEntry, ref),
            },
          ]
        : [];
    }),
  );

/** Collect phantom leaf references from plan entries that reference three-part UC names.
 *  These are placed in the UC hierarchy (not under workspace-root) via buildChainGraph. */
const collectExternalLeafPhantomRefs = (
  entries: readonly (readonly [string, PlanEntry])[],
  existingUcKeys: ReadonlySet<string>,
  registeredModelFullNameIndex: ReadonlyMap<string, string>,
): readonly ExternalLeafPhantomRef[] => {
  const refs: ExternalLeafPhantomRef[] = [];
  const specs = buildExternalLeafRefSpecs(existingUcKeys, registeredModelFullNameIndex);

  for (const spec of specs) {
    for (const [key, entry] of entries) {
      const resourceType = extractResourceType(key);
      if (resourceType === undefined || !spec.sourceTypes.has(resourceType)) continue;
      for (const identity of spec.extractIdentities(entry)) {
        refs.push({
          identity,
          phantomId: buildPrefixedNodeId(spec.phantomKind, identity),
          label: extractExternalLeafLabel(identity),
          phantomKind: spec.phantomKind,
        });
      }
    }
  }

  return refs;
};

type LeafRefSpec = {
  readonly sourceTypes: ReadonlySet<string>;
  readonly extractIdentities: (entry: PlanEntry) => readonly string[];
  readonly phantomKind: PhantomKind;
};

const extractExternalLeafLabel = (identity: string): string =>
  identity.split(".").at(-1) ?? identity;

const collectThreePartIdentity = (identity: string | undefined): readonly string[] =>
  identity !== undefined && parseThreePartName(identity) !== undefined ? [identity] : [];

const collectServingEndpointModelIdentities = (
  entry: PlanEntry,
  existingUcKeys: ReadonlySet<string>,
  registeredModelFullNameIndex: ReadonlyMap<string, string>,
): readonly string[] => {
  const identities: string[] = [];
  for (const entity of extractServedEntities(entry)) {
    const name = getUnknownProp(entity, "entity_name");
    if (typeof name !== "string") continue;
    const targetKey =
      registeredModelFullNameIndex.get(name) ?? buildResourceKey("registered_models", name);
    if (existingUcKeys.has(targetKey)) continue;
    if (parseThreePartName(name) !== undefined) identities.push(name);
  }
  return identities;
};

const collectAppUcSecurableIdentities = (entry: PlanEntry): readonly string[] => {
  const identities: string[] = [];
  for (const ref of extractAppResourceReferences(entry)) {
    if (ref.kind === "uc_securable" && parseThreePartName(ref.fullName) !== undefined) {
      identities.push(ref.fullName);
    }
  }
  return identities;
};

const buildExternalLeafRefSpecs = (
  existingUcKeys: ReadonlySet<string>,
  registeredModelFullNameIndex: ReadonlyMap<string, string>,
): readonly LeafRefSpec[] => [
  {
    sourceTypes: new Set(["model_serving_endpoints"]),
    extractIdentities: (entry) =>
      collectServingEndpointModelIdentities(entry, existingUcKeys, registeredModelFullNameIndex),
    phantomKind: "registeredModel",
  },
  {
    sourceTypes: new Set(["quality_monitors"]),
    extractIdentities: (entry) => collectThreePartIdentity(extractStateField(entry, "table_name")),
    phantomKind: "sourceTable",
  },
  {
    sourceTypes: new Set(["postgres_synced_tables"]),
    extractIdentities: (entry) => collectThreePartIdentity(extractSourceTableFullName(entry)),
    phantomKind: "sourceTable",
  },
  {
    sourceTypes: new Set(["apps"]),
    extractIdentities: collectAppUcSecurableIdentities,
    phantomKind: "sourceTable",
  },
];

const collectExternalPostgresDatabaseRefs = (
  entries: readonly (readonly [string, PlanEntry])[],
): readonly ExternalHierarchyRef[] => {
  const refs: ExternalHierarchyRef[] = [];

  for (const [key, entry] of entries) {
    const resourceType = extractResourceType(key);
    if (resourceType !== "postgres_catalogs") continue;

    const branch = extractStateField(entry, "branch");
    const postgresDatabase = extractStateField(entry, "postgres_database");
    if (branch === undefined || postgresDatabase === undefined) continue;
    if (resolvePostgresDatabaseResourceKey(branch, postgresDatabase, entries) !== undefined) {
      continue;
    }

    const branchIdentity = resolvePostgresBranchRefIdentityFromEntries(branch, entries);
    if (branchIdentity === undefined) continue;
    refs.push({
      identity: `${branchIdentity}/${postgresDatabase}`,
      tierIndex: POSTGRES_DATABASE_TIER_INDEX,
    });
  }

  return refs;
};

// ---------------------------------------------------------------------------
// Main orchestrator
// ---------------------------------------------------------------------------

/** Build the complete resource graph for all plan entries. */
export const buildResourceGraph = (
  plan: Plan,
): PlanGraph & { readonly lateralEdges: readonly GraphEdge[] } => {
  const { entries: normalizedEntries, orphanEffects } = normalizePlan(plan.plan ?? {});
  const entries = Object.entries(normalizedEntries);

  if (entries.length === 0 && orphanEffects.size === 0) {
    return { nodes: [], edges: [], lateralEdges: [] };
  }

  const ucEntries: [string, NormalizedEntry][] = [];
  const postgresEntries: [string, NormalizedEntry][] = [];
  const workspaceEntries: [string, NormalizedEntry][] = [];
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

  // Build registered model index early — needed for external leaf phantom dedup
  const registeredModelFullNameIndex = buildApiIdIndex(entries, "registered_models", (e) =>
    extractStateField(e, "full_name"),
  );

  const existingUcKeys = new Set(ucEntries.map(([key]) => key));
  const externalDerivedLeafRefs = collectExternalDerivedLeafRefs(entries);
  const externalLeafPhantomRefs = collectExternalLeafPhantomRefs(
    entries,
    existingUcKeys,
    registeredModelFullNameIndex,
  );

  const ucGraph = buildChainGraph(
    ucEntries,
    UC_CHAIN,
    externalLeafPhantomRefs,
    undefined,
    externalDerivedLeafRefs,
  );
  const externalPostgresDatabaseRefs = collectExternalPostgresDatabaseRefs(entries);
  const workspaceDerivedRefs = collectWorkspaceDerivedNodeRefs(entries);
  const { graph: workspaceGraph, placement: workspacePlacement } = buildWorkspaceGraph(
    workspaceEntries,
    postgresEntries,
    externalPostgresDatabaseRefs,
    workspaceDerivedRefs,
  );

  // depends_on edges are NOT used for graph construction. They represent
  // deployment ordering (Terraform-style: "deploy X before Y so ${resources.X.id}
  // resolves"), not semantic relationships. Every depends_on is already covered by:
  //   - UC hierarchy edges (volumes under schemas)
  //   - Lateral edges (job→warehouse, app→job, etc.)
  // New cross-resource reference patterns should add lateral specs in
  // extract-lateral-edges.ts, not re-add depends_on edge creation.

  const graphNodes = [...ucGraph.nodes, ...workspaceGraph.nodes];

  // Build shared indexes once for all phantom collectors and lateral edge specs
  const warehouseIndex = buildApiIdIndex(entries, "sql_warehouses", (e) =>
    extractStateField(e, "id"),
  );
  const dashboardIndex = buildApiIdIndex(entries, "dashboards", (e) =>
    extractStateField(e, "dashboard_id"),
  );
  const pipelineIndex = new Map([
    ...buildDerivedReferenceIndex(entries, "pipelines"),
    ...buildApiIdIndex(entries, "pipelines", (e) => extractStateField(e, "pipeline_id")),
  ]);
  const genieSpaceIndex = buildApiIdIndex(entries, "genie_spaces", extractGenieSpaceApiId);
  const jobIndex = buildApiIdIndex(entries, "jobs", extractJobApiId);
  const experimentIndex = buildApiIdIndex(entries, "experiments", (e) =>
    extractStateField(e, "experiment_id"),
  );
  const jobIdMap = buildJobIdMap(entries);
  const referenceIndexes: ReferenceIndexes = {
    warehouseIndex,
    dashboardIndex,
    pipelineIndex,
    genieSpaceIndex,
    jobIndex,
    experimentIndex,
    registeredModelFullNameIndex,
    jobIdMap,
  };

  // Create phantom nodes for database instances referenced but not in the plan.
  const existingKeys = new Set(graphNodes.map((node) => node.resourceKey));
  const phantomDbInstances = buildWorkspacePhantomGraph(
    collectPhantomDatabaseInstances(entries, existingKeys),
    workspacePlacement,
  );

  // Create phantom nodes for app resource references (secret scopes, serving endpoints).
  const phantomAppDeps = buildWorkspacePhantomGraph(
    collectPhantomAppDependencies(entries, existingKeys, referenceIndexes),
    workspacePlacement,
  );

  // Create phantom nodes for external references (warehouses, dashboards, pipelines) from
  // top-level resources and job task sub-objects.
  const phantomExternalRefs = buildWorkspacePhantomGraph(
    collectPhantomExternalRefs(entries, referenceIndexes),
    workspacePlacement,
  );

  // Phantom nodes carrying deploy-triggered runs whose target job is not in
  // the plan. Listed before the external-ref phantoms so an id collision with
  // a bare run_job_task phantom keeps the effects-annotated node.
  const orphanEffectPhantoms = buildWorkspacePhantomGraph(
    buildOrphanEffectPhantoms(orphanEffects),
    workspacePlacement,
  );
  const workspacePhantomGraphs = [
    orphanEffectPhantoms,
    phantomDbInstances,
    phantomAppDeps,
    phantomExternalRefs,
  ];
  const otherResourcesGraph = buildOtherResourcesGraph([workspaceGraph, ...workspacePhantomGraphs]);

  // Workspace phantoms can be the only workspace content. Materialize their
  // parent root when no real workspace or Postgres entry created it.
  const workspaceParentNodes =
    workspacePhantomGraphs.some((graph) => graph.nodes.length > 0) &&
    !graphNodes.some((node) => node.id === WORKSPACE_ROOT_ID)
      ? [buildHierarchyGraphNode("root", WORKSPACE_ROOT_ID, "Workspace")]
      : [];

  const allNodes = dedupeById([
    ...graphNodes,
    ...otherResourcesGraph.nodes,
    ...workspaceParentNodes,
    ...workspacePhantomGraphs.flatMap((graph) => graph.nodes),
  ]);

  // Lateral specs only emit edges to node IDs that already exist, so build
  // lookup maps after all real and phantom nodes have been materialized.
  const nodeIdByResourceKey = new Map<string, string>(
    allNodes.map((node) => [node.resourceKey, node.id]),
  );
  const nodeIds = new Set<string>(allNodes.map((node) => node.id));

  const lateralEdges = extractLateralEdges(
    { entries, nodeIdByResourceKey, nodeIds },
    referenceIndexes,
  );

  return {
    nodes: allNodes,
    edges: dedupeById([
      ...ucGraph.edges,
      ...otherResourcesGraph.edges,
      ...workspaceGraph.edges,
      ...workspacePhantomGraphs.flatMap((graph) => graph.edges),
    ]),
    lateralEdges,
  };
};
