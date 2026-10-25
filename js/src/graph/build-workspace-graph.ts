import { mapActionToDiffState } from "../parser/map-diff-state.ts";
import {
  buildEdge,
  buildHierarchyGraphNode,
  type DerivedGraphNode,
  filterDefinedEdges,
  type PhantomGraphNode,
  type PlanGraph,
  toEdgeDiffState,
} from "../types/graph-types.ts";
import type { PlanEntry } from "../types/plan-schema.ts";
import type { PreparedPlan } from "../types/prepared-plan.ts";
import type { PhantomPlacement, ReferenceIdentityCatalog } from "../types/reference-resolution.ts";
import { extractPhantomResourceType, extractResourceType } from "../utils/resource-key.ts";
import { buildChainGraph, type ExternalHierarchyRef } from "./build-hierarchy-graph.ts";
import { buildDerivedNode, buildResourceNode } from "./build-resource-nodes.ts";
import { extractDerivedPlacement, type OwnedDerivedNodeRefs } from "./derived-node-specs.ts";
import { createPostgresChain } from "./hierarchy-specs.ts";

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

export type WorkspacePlacement = {
  readonly categoryTypes: ReadonlySet<string>;
  readonly fallbackParentId: string;
};

export type WorkspaceDerivedNodeRef = {
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
  return new Set([...counts].filter(([, count]) => count > 1).map(([type]) => type));
};

export const buildWorkspacePlacement = (
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

const getCurrentState = (plan: PreparedPlan, key: string) =>
  plan.byResourceKey.get(key)?.currentState ?? ({ status: "absent" } as const);

const getPreparedJob = (plan: PreparedPlan, key: string) => {
  const projection = plan.byResourceKey.get(key)?.job;
  return projection?.status === "supported" ? projection.value : undefined;
};

const buildFlatWorkspaceGraph = (
  entries: readonly (readonly [string, PlanEntry])[],
  placement: WorkspacePlacement,
  plan: PreparedPlan,
): PlanGraph => {
  const categories = buildWorkspaceCategoryGraph(placement.categoryTypes);
  const nodes = entries.map(([key, entry]) =>
    buildResourceNode(key, entry, undefined, getPreparedJob(plan, key), getCurrentState(plan, key)),
  );
  const edges = entries.map(([key, entry]) =>
    buildEdge(
      resolveWorkspaceTypeParentId(extractResourceType(key), placement),
      key,
      toEdgeDiffState(mapActionToDiffState(entry.action)),
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

export const buildWorkspacePhantomGraph = (
  nodes: readonly PhantomGraphNode[],
  placement: WorkspacePlacement,
  referencePlacements: ReadonlyMap<string, PhantomPlacement> = new Map(),
): PlanGraph => ({
  nodes,
  edges: filterDefinedEdges(
    nodes.map((node) => {
      const referencePlacement = referencePlacements.get(node.id);
      const resourceType =
        referencePlacement?.kind === "workspace-resource"
          ? referencePlacement.resourceType
          : extractPhantomResourceType(node.id);
      return buildEdge(resolveWorkspaceTypeParentId(resourceType, placement), node.id);
    }),
  ),
});

export const buildOtherResourcesGraph = (graphs: readonly PlanGraph[]): PlanGraph => {
  const hasOtherResources = graphs.some((graph) =>
    graph.edges.some((edge) => edge.source === OTHER_RESOURCES_ROOT_ID),
  );
  if (!hasOtherResources) return { nodes: [], edges: [] };
  return {
    nodes: [buildHierarchyGraphNode("root", OTHER_RESOURCES_ROOT_ID, "Other Resources")],
    edges: filterDefinedEdges([buildEdge(WORKSPACE_ROOT_ID, OTHER_RESOURCES_ROOT_ID)]),
  };
};

export const collectWorkspaceDerivedNodeRefs = (
  entries: readonly (readonly [string, PlanEntry])[],
  ownedRefs: OwnedDerivedNodeRefs,
): readonly WorkspaceDerivedNodeRef[] =>
  entries.flatMap(([ownerResourceKey, ownerEntry]) =>
    (ownedRefs.get(ownerResourceKey) ?? []).flatMap((ref) => {
      const placement = extractDerivedPlacement(ref.derivedKind);
      const resourceType = placement.kind === "workspace" ? placement.resourceType : undefined;
      return resourceType === undefined
        ? []
        : [{ resourceType, node: buildDerivedNode(ownerResourceKey, ownerEntry, ref) }];
    }),
  );

export const buildWorkspaceGraph = (
  workspaceEntries: readonly (readonly [string, PlanEntry])[],
  postgresEntries: readonly (readonly [string, PlanEntry])[],
  externalPostgresHierarchyRefs: readonly ExternalHierarchyRef[],
  derivedRefs: readonly WorkspaceDerivedNodeRef[],
  plan: PreparedPlan,
  identityCatalog: ReferenceIdentityCatalog,
): { readonly graph: PlanGraph; readonly placement: WorkspacePlacement } => {
  const hasWorkspace = workspaceEntries.length > 0 || derivedRefs.length > 0;
  const hasPostgres = postgresEntries.length > 0 || externalPostgresHierarchyRefs.length > 0;
  const placement = buildWorkspacePlacement(workspaceEntries, derivedRefs, hasPostgres);
  if (!hasWorkspace && !hasPostgres) return { graph: { nodes: [], edges: [] }, placement };
  const root = buildHierarchyGraphNode("root", WORKSPACE_ROOT_ID, "Workspace");
  const workspaceGraph = buildFlatWorkspaceGraph(workspaceEntries, placement, plan);
  const derivedGraph = buildWorkspaceDerivedGraph(derivedRefs, placement);
  const postgresGraph = hasPostgres
    ? buildChainGraph(
        postgresEntries,
        createPostgresChain(plan, postgresEntries, identityCatalog),
        plan,
        undefined,
        externalPostgresHierarchyRefs,
      )
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
