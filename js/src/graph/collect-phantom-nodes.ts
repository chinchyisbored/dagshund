import { buildHierarchyGraphNode, type PhantomGraphNode } from "../types/graph-types.ts";
import type { ReferenceResolution } from "../types/reference-resolution.ts";
import type { NormalizedPlan } from "../utils/normalize-plan.ts";
import { buildPrefixedNodeId } from "../utils/resource-key.ts";

type PhantomEntry = { readonly id: string; readonly label: string; readonly resourceKey: string };

/** Convert a deduped phantom entry map into graph nodes. */
const buildPhantomNodesFromEntries = (
  phantoms: ReadonlyMap<string, PhantomEntry>,
): readonly PhantomGraphNode[] =>
  [...phantoms.values()].map(({ id, label, resourceKey }) =>
    buildHierarchyGraphNode("phantom", id, label, resourceKey),
  );

// ---------------------------------------------------------------------------
// Phantom targets of orphan deploy effects
// ---------------------------------------------------------------------------

/** Build phantom nodes for deploy-triggered runs whose target job is absent
 *  from the plan, keyed by phantom node id (`job::<id>`). The effects ride on
 *  the phantom so the badge and detail panel can show them (dagshund-ocb1). */
export const buildOrphanEffectPhantoms = (
  orphanEffects: NormalizedPlan["orphanEffects"],
): readonly PhantomGraphNode[] =>
  orphanEffects.map(({ targetId, effects }) => {
    const id = buildPrefixedNodeId("job", String(targetId));
    return {
      ...buildHierarchyGraphNode("phantom", id, String(targetId)),
      effects,
    };
  });

// ---------------------------------------------------------------------------
// Materialize phantom targets from the shared reference-resolution stream
// ---------------------------------------------------------------------------

/** Collect phantom nodes from top-level warehouse references and job task sub-objects
 *  (warehouses, dashboards, pipelines, cross-job run_job_task). */
export const collectPhantomWarehouseReferences = (
  references: readonly ReferenceResolution[],
): readonly PhantomGraphNode[] => {
  const phantoms = new Map<string, PhantomEntry>();
  for (const reference of references) {
    if (reference.kind !== "phantom") continue;
    phantoms.set(reference.targetNodeId, {
      id: reference.targetNodeId,
      resourceKey: reference.resourceKey,
      label: reference.label,
    });
  }
  return buildPhantomNodesFromEntries(phantoms);
};
