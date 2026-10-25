import { mapActionToDiffState } from "../parser/map-diff-state.ts";
import type {
  DerivedGraphNode,
  GraphEdge,
  PhantomGraphNode,
  PlanGraph,
  ResourceGraphNode,
} from "../types/graph-types.ts";
import {
  buildEdge,
  buildHierarchyGraphNode,
  filterDefinedEdges,
  toEdgeDiffState,
} from "../types/graph-types.ts";
import type { PlanEntry } from "../types/plan-schema.ts";
import type { PreparedPlan } from "../types/prepared-plan.ts";
import type { PhantomKind } from "../utils/resource-key.ts";
import { extractResourceType } from "../utils/resource-key.ts";
import { buildResourceNode } from "./build-resource-nodes.ts";
import { extractPromotedPhantomKind } from "./derived-node-specs.ts";
import { parseThreePartName } from "./extract-resource-state.ts";
import type { ChainSpec, TierSpec } from "./hierarchy-specs.ts";

export type ExternalLeafPhantomRef = {
  readonly identity: string;
  readonly phantomId: string;
  readonly label: string;
  readonly phantomKind: PhantomKind;
};

export type ExternalHierarchyRef = {
  readonly identity: string;
  readonly tierIndex: number;
};

export type ExternalDerivedLeafRef = {
  readonly identity: string;
  readonly node: DerivedGraphNode;
};

type TierIndex = {
  readonly byIdentity: ReadonlyMap<string, string>;
  readonly byResourceKey: ReadonlyMap<string, string>;
};

const buildTierIndexes = (
  entries: readonly (readonly [string, PlanEntry])[],
  tiers: readonly TierSpec[],
  plan: PreparedPlan,
): readonly TierIndex[] =>
  tiers.map((tier) => {
    const identityPairs: [string, string][] = [];
    const resourceKeyPairs: [string, string][] = [];
    for (const [key] of entries) {
      const resourceType = extractResourceType(key);
      if (resourceType === undefined || !tier.resourceTypes.has(resourceType)) continue;
      const identity = tier.resolveIdentity(getCurrentState(plan, key), key, entries);
      const nodeId =
        tier.useHierarchyId === true && identity !== undefined
          ? tier.buildHierarchyId(identity)
          : key;
      resourceKeyPairs.push([key, nodeId]);
      if (identity !== undefined) identityPairs.push([identity, nodeId]);
    }
    return { byIdentity: new Map(identityPairs), byResourceKey: new Map(resourceKeyPairs) };
  });

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
  const existingNodeId = index.byIdentity.get(identity);
  if (existingNodeId !== undefined) return existingNodeId;

  const phantomId = tier.buildHierarchyId(identity);
  if (!phantomAccumulator.has(phantomId)) {
    const phantomLabel = identity.split(/[./]/).at(-1) ?? identity;
    phantomAccumulator.set(phantomId, buildHierarchyGraphNode("phantom", phantomId, phantomLabel));
  }

  const parentRef = tierIndex > 0 ? tier.deriveParentRef?.(identity) : undefined;
  if (parentRef === undefined) {
    phantomEdgeAccumulator.push(buildEdge(spec.rootId, phantomId));
    return phantomId;
  }
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

const resolveEntryNode = (
  key: string,
  entry: PlanEntry,
  tier: TierSpec,
  entries: readonly (readonly [string, PlanEntry])[],
  plan: PreparedPlan,
): { readonly node: ResourceGraphNode; readonly nodeId: string } => {
  if (tier.useHierarchyId === true) {
    const identity = tier.resolveIdentity(getCurrentState(plan, key), key, entries);
    if (identity !== undefined) {
      const hierarchyId = tier.buildHierarchyId(identity);
      const label = extractResourceType(key) === "postgres_catalogs" ? identity : undefined;
      return {
        node: buildResourceNode(
          key,
          entry,
          { id: hierarchyId, label },
          getPreparedJob(plan, key),
          getCurrentState(plan, key),
        ),
        nodeId: hierarchyId,
      };
    }
  }
  return {
    node: buildResourceNode(
      key,
      entry,
      undefined,
      getPreparedJob(plan, key),
      getCurrentState(plan, key),
    ),
    nodeId: key,
  };
};

const getCurrentState = (plan: PreparedPlan, key: string) =>
  plan.byResourceKey.get(key)?.currentState ?? ({ status: "absent" } as const);

const getPreparedJob = (plan: PreparedPlan, key: string) => {
  const projection = plan.byResourceKey.get(key)?.job;
  return projection?.status === "supported" ? projection.value : undefined;
};

const resolveEntryParent = (
  key: string,
  tier: TierSpec,
  tierIndex: number,
  spec: ChainSpec,
  tierIndexes: readonly TierIndex[],
  entries: readonly (readonly [string, PlanEntry])[],
  plan: PreparedPlan,
  phantomAccumulator: Map<string, PhantomGraphNode>,
  phantomEdgeAccumulator: (GraphEdge | undefined)[],
): string => {
  const rawParentRef = tier.resolveParentRef(getCurrentState(plan, key), key, entries);
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

/** Build the hierarchy subgraph described by a chain specification. */
export const buildChainGraph = (
  entries: readonly (readonly [string, PlanEntry])[],
  spec: ChainSpec,
  plan: PreparedPlan,
  externalLeafPhantomRefs?: readonly ExternalLeafPhantomRef[],
  externalHierarchyRefs?: readonly ExternalHierarchyRef[],
  externalDerivedLeafRefs?: readonly ExternalDerivedLeafRef[],
): PlanGraph => {
  const hasExternalRefs =
    (externalLeafPhantomRefs?.length ?? 0) > 0 ||
    (externalHierarchyRefs?.length ?? 0) > 0 ||
    (externalDerivedLeafRefs?.length ?? 0) > 0;
  if (entries.length === 0 && !hasExternalRefs) return { nodes: [], edges: [] };

  const root = buildHierarchyGraphNode("root", spec.rootId, spec.rootLabel);
  const tierIndexes = buildTierIndexes(entries, spec.tiers, plan);
  const promotedPhantomIdentities = collectPromotedPhantomIdentities(externalDerivedLeafRefs ?? []);
  const resourceNodes: ResourceGraphNode[] = [];
  const derivedNodes = new Map<string, DerivedGraphNode>();
  const phantomNodes = new Map<string, PhantomGraphNode>();
  const phantomEdges: (GraphEdge | undefined)[] = [];
  const hierarchyEdges: (GraphEdge | undefined)[] = [];

  for (const [key, entry] of entries) {
    const resourceType = extractResourceType(key);
    if (resourceType === undefined) continue;
    const tierIndex = spec.tiers.findIndex((tier) => tier.resourceTypes.has(resourceType));
    if (tierIndex === -1) continue;
    const tier = spec.tiers[tierIndex];
    if (tier === undefined) continue;
    const { node, nodeId } = resolveEntryNode(key, entry, tier, entries, plan);
    resourceNodes.push(node);
    const parentNodeId = resolveEntryParent(
      key,
      tier,
      tierIndex,
      spec,
      tierIndexes,
      entries,
      plan,
      phantomNodes,
      phantomEdges,
    );
    hierarchyEdges.push(
      buildEdge(parentNodeId, nodeId, toEdgeDiffState(mapActionToDiffState(entry.action))),
    );
  }

  for (const ref of externalHierarchyRefs ?? []) {
    resolveParentChain(ref.identity, ref.tierIndex, spec, tierIndexes, phantomNodes, phantomEdges);
  }

  for (const { identity, phantomId, label, phantomKind } of externalLeafPhantomRefs ?? []) {
    if (
      isPromotedPhantomIdentity(promotedPhantomIdentities, phantomKind, identity) ||
      phantomNodes.has(phantomId)
    )
      continue;
    const parsed = parseThreePartName(identity);
    if (parsed === undefined) continue;
    const parentNodeId = resolveParentChain(
      `${parsed.catalog}.${parsed.schema}`,
      spec.tiers.length - 2,
      spec,
      tierIndexes,
      phantomNodes,
      phantomEdges,
    );
    phantomNodes.set(phantomId, buildHierarchyGraphNode("phantom", phantomId, label));
    phantomEdges.push(buildEdge(parentNodeId, phantomId));
  }

  for (const { identity, node } of externalDerivedLeafRefs ?? []) {
    if (derivedNodes.has(node.id)) continue;
    const parsed = parseThreePartName(identity);
    if (parsed === undefined) continue;
    const parentNodeId = resolveParentChain(
      `${parsed.catalog}.${parsed.schema}`,
      spec.tiers.length - 2,
      spec,
      tierIndexes,
      phantomNodes,
      phantomEdges,
    );
    derivedNodes.set(node.id, node);
    hierarchyEdges.push(buildEdge(parentNodeId, node.id, toEdgeDiffState(node.diffState)));
  }

  return {
    nodes: [root, ...resourceNodes, ...derivedNodes.values(), ...phantomNodes.values()],
    edges: [...filterDefinedEdges(hierarchyEdges), ...filterDefinedEdges(phantomEdges)],
  };
};
