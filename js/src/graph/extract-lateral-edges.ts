import { buildGraphEdge, type GraphEdge } from "../types/graph-types.ts";
import type { ReferenceResolution } from "../types/reference-resolution.ts";
import { LATERAL_EDGE_PREFIX } from "../utils/resource-key.ts";
import type { LateralEdgeContext, ReferenceIndexes } from "./reference-specs.ts";

/** Emit edges only for resolved targets already present in the materialized graph. */
export const extractLateralEdges = (
  context: LateralEdgeContext,
  _indexes: ReferenceIndexes,
  references: readonly ReferenceResolution[] = [],
): readonly GraphEdge[] => {
  const seen = new Set<string>();
  return references.flatMap((reference) => {
    if (reference.kind !== "resolved" && reference.kind !== "phantom") return [];
    const sourceNodeId = context.nodeIdByResourceKey.get(reference.sourceResourceKey);
    if (sourceNodeId === undefined || !context.nodeIds.has(sourceNodeId)) return [];
    if (!context.nodeIds.has(reference.targetNodeId)) return [];
    const source =
      reference.direction === "entry-to-target" ? sourceNodeId : reference.targetNodeId;
    const target =
      reference.direction === "entry-to-target" ? reference.targetNodeId : sourceNodeId;
    const pair = `${source}→${target}`;
    if (seen.has(pair)) return [];
    seen.add(pair);
    return [buildGraphEdge(source, target, "unchanged", LATERAL_EDGE_PREFIX)];
  });
};
