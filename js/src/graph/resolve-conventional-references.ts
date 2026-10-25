import type { ReferenceResolution } from "../types/reference-resolution.ts";
import { buildPrefixedNodeId, extractResourceType } from "../utils/resource-key.ts";
import type { ReferenceResolutionContext } from "./reference-resolution-context.ts";
import { CONVENTIONAL_REFERENCE_SPECS } from "./reference-specs.ts";

export const resolveConventionalReference = (
  sourceResourceKey: string,
  context: ReferenceResolutionContext,
): ReferenceResolution => {
  const resourceType = extractResourceType(sourceResourceKey);
  const spec = Object.values(CONVENTIONAL_REFERENCE_SPECS).find(
    (candidate) => resourceType !== undefined && candidate.sourceTypes.has(resourceType),
  );
  if (spec === undefined) return { kind: "absent", sourceResourceKey };

  const extraction = spec.extract(context.preparedPlan.byResourceKey.get(sourceResourceKey));
  if (extraction.kind === "unsupported") {
    return { kind: "unsupported", sourceResourceKey, diagnostic: extraction.diagnostic };
  }
  if (extraction.kind === "absent") return { kind: "absent", sourceResourceKey };
  const reference = extraction.value;

  const targetResourceKey = context.identityCatalog.resourceKeyByAlias.get(
    `${spec.targetResourceType}:${reference}`,
  );
  const targetNodeId =
    targetResourceKey === undefined
      ? undefined
      : (context.identityCatalog.nodeIdByAlias.get(`${spec.targetResourceType}:${reference}`) ??
        context.identityCatalog.nodeIdByResourceKey.get(targetResourceKey));
  if (targetResourceKey !== undefined && targetNodeId !== undefined) {
    return {
      kind: "resolved",
      sourceResourceKey,
      targetNodeId,
      targetResourceKey,
      provenance: "real",
      direction: spec.direction,
    };
  }

  if (!spec.phantomPolicy) return { kind: "absent", sourceResourceKey };
  const targetNodeIdForPhantom = buildPrefixedNodeId(spec.phantomKind, reference);
  return {
    kind: "phantom",
    sourceResourceKey,
    targetNodeId: targetNodeIdForPhantom,
    resourceKey: targetNodeIdForPhantom,
    label: reference,
    phantomKind: spec.phantomKind,
    placement: spec.phantomPlacement,
    direction: spec.direction,
  };
};
