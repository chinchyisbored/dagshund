import { buildHierarchyGraphNode, type GraphEdge, type PlanGraph } from "../types/graph-types.ts";
import type { PlanEntry } from "../types/plan-schema.ts";
import type { PreparedPlan } from "../types/prepared-plan.ts";
import type { ReferenceResolution } from "../types/reference-resolution.ts";
import type { NormalizedEntry } from "../utils/normalize-plan.ts";
import { extractResourceType } from "../utils/resource-key.ts";
import {
  buildChainGraph,
  type ExternalDerivedLeafRef,
  type ExternalHierarchyRef,
  type ExternalLeafPhantomRef,
  type ExternalRootLeafRef,
} from "./build-hierarchy-graph.ts";
import { buildReferenceIdentityCatalog } from "./build-reference-identity-catalog.ts";
import { buildDerivedNode, isJobEntry } from "./build-resource-nodes.ts";
import {
  buildOtherResourcesGraph,
  buildWorkspaceGraph,
  buildWorkspacePhantomGraph,
  collectWorkspaceDerivedNodeRefs,
} from "./build-workspace-graph.ts";
import {
  buildOrphanEffectPhantoms,
  collectPhantomWarehouseReferences,
} from "./collect-phantom-nodes.ts";
import {
  buildDerivedReferenceIndex,
  collectOwnedDerivedNodeRefs,
  extractDerivedPlacement,
  extractPromotedPhantomKind,
  type OwnedDerivedNodeRefs,
} from "./derived-node-specs.ts";
import { extractLateralEdges } from "./extract-lateral-edges.ts";
import { extractHistoricalStateField, extractStateField } from "./extract-resource-state.ts";
import {
  isPostgresType,
  isUnityCatalogType,
  POSTGRES_DATABASE_TIER_INDEX,
  UC_CHAIN,
} from "./hierarchy-specs.ts";
import {
  buildApiIdIndex,
  extractGenieSpaceApiId,
  extractJobApiId,
  type ReferenceIndexes,
} from "./reference-specs.ts";
import { resolveReferences } from "./resolve-references.ts";
import { buildJobIdMap } from "./resolve-run-job-target.ts";

// ---------------------------------------------------------------------------
// Node builders
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// External UC leaf refs
// ---------------------------------------------------------------------------

const collectExternalDerivedLeafRefs = (
  entries: readonly (readonly [string, PlanEntry])[],
  ownedRefs: OwnedDerivedNodeRefs,
): readonly ExternalDerivedLeafRef[] =>
  entries.flatMap(([ownerResourceKey, ownerEntry]) =>
    (ownedRefs.get(ownerResourceKey) ?? []).flatMap((ref) =>
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

/** Collect phantom leaf references from plan entries that reference three-part UC names.
 *  These are placed in the UC hierarchy (not under workspace-root) via buildChainGraph. */
const collectExternalLeafPhantomRefs = (
  references: readonly ReferenceResolution[],
): readonly ExternalLeafPhantomRef[] =>
  references.flatMap((reference) =>
    reference.kind === "phantom" &&
    reference.placement.kind === "hierarchy" &&
    reference.placement.tier === 2 &&
    (reference.phantomKind === "sourceTable" ||
      reference.phantomKind === "registeredModel" ||
      reference.phantomKind === "volume" ||
      reference.phantomKind === "function" ||
      reference.phantomKind === "externalConnection" ||
      reference.phantomKind === "modelProviderService" ||
      reference.phantomKind === "serviceCredential")
      ? [
          {
            identity: reference.placement.identity,
            phantomId: reference.targetNodeId,
            label: reference.label,
            phantomKind: reference.phantomKind,
          },
        ]
      : [],
  );

const collectExternalRootLeafRefs = (
  references: readonly ReferenceResolution[],
): readonly ExternalRootLeafRef[] =>
  references.flatMap((reference) =>
    reference.kind === "phantom" && reference.placement.kind === "uc-root"
      ? [
          {
            nodeId: reference.targetNodeId,
            label: reference.label,
          },
        ]
      : [],
  );

const collectExternalHierarchyRefs = (
  references: readonly ReferenceResolution[],
): readonly ExternalHierarchyRef[] =>
  references.flatMap((reference) =>
    reference.kind === "phantom" &&
    reference.phantomKind === "schema" &&
    reference.placement.kind === "hierarchy"
      ? [{ identity: reference.placement.identity, tierIndex: reference.placement.tier }]
      : [],
  );

const collectExternalPostgresRefs = (
  references: readonly ReferenceResolution[],
): readonly ExternalHierarchyRef[] =>
  references.flatMap((reference) =>
    reference.kind === "phantom" &&
    reference.placement.kind === "hierarchy" &&
    (reference.phantomKind === "postgresDatabase" || reference.phantomKind === "postgresBranch")
      ? [
          {
            identity: reference.placement.identity,
            tierIndex:
              reference.phantomKind === "postgresDatabase" ? POSTGRES_DATABASE_TIER_INDEX : 1,
          },
        ]
      : [],
  );

// ---------------------------------------------------------------------------
// Main orchestrator
// ---------------------------------------------------------------------------

/** Build the complete resource graph for all plan entries. */
export const buildResourceGraph = (
  plan: PreparedPlan,
): PlanGraph & { readonly lateralEdges: readonly GraphEdge[] } => {
  const { entries: normalizedEntries, orphanEffects } = plan.normalized;
  const entries = Object.entries(normalizedEntries);

  if (entries.length === 0 && orphanEffects.length === 0) {
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

  const ownedDerivedRefs = collectOwnedDerivedNodeRefs(plan.byResourceKey);
  const externalDerivedLeafRefs = collectExternalDerivedLeafRefs(entries, ownedDerivedRefs);
  const servedEntityNames = new Map(
    [...plan.byResourceKey].flatMap(([key, resource]) =>
      resource.servedEntityNames.status === "supported"
        ? [[key, resource.servedEntityNames.value] as const]
        : [],
    ),
  );
  // Build shared identity facts before hierarchy and phantom materialization.
  const warehouseIndex = buildApiIdIndex(entries, "sql_warehouses", (e) =>
    extractHistoricalStateField(e, "id"),
  );
  const dashboardIndex = buildApiIdIndex(entries, "dashboards", (e) =>
    extractHistoricalStateField(e, "dashboard_id"),
  );
  const alertIndex = buildApiIdIndex(entries, "alerts", (e) =>
    extractHistoricalStateField(e, "id"),
  );
  const pipelineIndex = new Map([
    ...buildDerivedReferenceIndex("pipelines", ownedDerivedRefs, plan.byResourceKey),
    ...buildApiIdIndex(entries, "pipelines", (e) => extractHistoricalStateField(e, "pipeline_id")),
  ]);
  const genieSpaceIndex = buildApiIdIndex(entries, "genie_spaces", extractGenieSpaceApiId);
  const jobIndex = buildApiIdIndex(entries, "jobs", extractJobApiId);
  const experimentIndex = buildApiIdIndex(entries, "experiments", (e) =>
    extractHistoricalStateField(e, "experiment_id"),
  );
  const jobIdMap = buildJobIdMap(entries.filter(([key]) => isJobEntry(key)));
  const referenceIndexes: ReferenceIndexes = {
    warehouseIndex,
    dashboardIndex,
    alertIndex,
    pipelineIndex,
    genieSpaceIndex,
    jobIndex,
    experimentIndex,
    registeredModelFullNameIndex,
    jobIdMap,
  };
  const identityCatalog = buildReferenceIdentityCatalog(entries, referenceIndexes, plan);
  const referenceResolutions = resolveReferences({
    entries,
    indexes: referenceIndexes,
    preparedPlan: plan,
    identityCatalog,
    ownedDerivedRefs,
  });
  const externalPostgresDatabaseRefs = collectExternalPostgresRefs(referenceResolutions);
  const externalLeafPhantomRefs = collectExternalLeafPhantomRefs(referenceResolutions);
  const externalUcHierarchyRefs = collectExternalHierarchyRefs(referenceResolutions);
  const externalUcRootLeafRefs = collectExternalRootLeafRefs(referenceResolutions);

  const ucGraph = buildChainGraph(
    ucEntries,
    UC_CHAIN,
    plan,
    externalLeafPhantomRefs,
    externalUcHierarchyRefs,
    externalDerivedLeafRefs,
    externalUcRootLeafRefs,
  );
  const workspaceDerivedRefs = collectWorkspaceDerivedNodeRefs(entries, ownedDerivedRefs);
  const { graph: workspaceGraph, placement: workspacePlacement } = buildWorkspaceGraph(
    workspaceEntries,
    postgresEntries,
    externalPostgresDatabaseRefs,
    workspaceDerivedRefs,
    plan,
    identityCatalog,
  );

  // depends_on edges are NOT used for graph construction. They represent
  // deployment ordering (Terraform-style: "deploy X before Y so ${resources.X.id}
  // resolves"), not semantic relationships. Every depends_on is already covered by:
  //   - UC hierarchy edges (volumes under schemas)
  //   - Lateral edges (job→warehouse, app→job, etc.)
  // New cross-resource reference patterns should add lateral specs in
  // extract-lateral-edges.ts, not re-add depends_on edge creation.

  const graphNodes = [...ucGraph.nodes, ...workspaceGraph.nodes];

  // Create phantom nodes for database instances referenced but not in the plan.
  // Create phantom nodes for external references (warehouses, dashboards, pipelines) from
  // top-level resources and job task sub-objects.
  const warehouseReferencePlacements = new Map(
    referenceResolutions.flatMap((reference) =>
      reference.kind === "phantom" ? [[reference.targetNodeId, reference.placement] as const] : [],
    ),
  );
  const ucNodeIds = new Set(ucGraph.nodes.map((node) => node.id));
  const promotedSourceTableIdentities = new Set(
    externalDerivedLeafRefs.flatMap(({ identity, node }) =>
      extractPromotedPhantomKind(node.derivedKind) === "sourceTable" ? [identity] : [],
    ),
  );
  const workspacePhantomReferences = referenceResolutions.filter((reference) => {
    if (reference.kind !== "phantom") return true;
    if (ucNodeIds.has(reference.targetNodeId)) return false;
    if (reference.placement.kind === "uc-root") return false;
    if (
      reference.placement.kind === "hierarchy" &&
      (reference.phantomKind === "postgresBranch" || reference.phantomKind === "postgresDatabase")
    )
      return false;
    return !(
      reference.phantomKind === "sourceTable" &&
      promotedSourceTableIdentities.has(reference.targetNodeId.slice("source-table::".length))
    );
  });
  const phantomExternalRefs = buildWorkspacePhantomGraph(
    dedupeById(collectPhantomWarehouseReferences(workspacePhantomReferences)),
    workspacePlacement,
    warehouseReferencePlacements,
  );
  // Phantom nodes carrying deploy-triggered runs whose target job is not in
  // the plan. Listed before the external-ref phantoms so an id collision with
  // a bare run_job_task phantom keeps the effects-annotated node.
  const orphanEffectPhantoms = buildWorkspacePhantomGraph(
    buildOrphanEffectPhantoms(orphanEffects),
    workspacePlacement,
  );
  const workspacePhantomGraphs = [orphanEffectPhantoms, phantomExternalRefs];
  const otherResourcesGraph = buildOtherResourcesGraph([workspaceGraph, ...workspacePhantomGraphs]);

  // Workspace phantoms can be the only workspace content. Materialize their
  // parent root when no real workspace or Postgres entry created it.
  const workspaceParentNodes =
    workspacePhantomGraphs.some((graph) => graph.nodes.length > 0) &&
    !graphNodes.some((node) => node.id === "workspace-root")
      ? [buildHierarchyGraphNode("root", "workspace-root", "Workspace")]
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
    {
      preparedPlan: plan,
      identityCatalog,
      entries,
      nodeIdByResourceKey,
      nodeIds,
      servedEntityNames,
    },

    referenceIndexes,
    referenceResolutions,
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
