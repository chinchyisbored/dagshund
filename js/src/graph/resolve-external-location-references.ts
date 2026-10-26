import type { ReferenceResolution } from "../types/reference-resolution.ts";
import { buildPrefixedNodeId, extractResourceType } from "../utils/resource-key.ts";
import type { ReferenceResolutionContext } from "./reference-resolution-context.ts";

export const resolveExternalLocationReferences = (
  sourceResourceKey: string,
  context: ReferenceResolutionContext,
): readonly ReferenceResolution[] => {
  if (extractResourceType(sourceResourceKey) !== "external_locations") return [];
  const projection =
    context.preparedPlan.byResourceKey.get(sourceResourceKey)?.externalLocationCredentialName;
  if (projection?.status !== "supported") return [];
  const credentialName = projection.value;
  const nodeId = buildPrefixedNodeId("storageCredential", credentialName);
  return [
    {
      kind: "phantom",
      sourceResourceKey,
      targetNodeId: nodeId,
      resourceKey: nodeId,
      label: credentialName,
      phantomKind: "storageCredential",
      placement: { kind: "uc-root" },
      direction: "entry-to-target",
    },
  ];
};
