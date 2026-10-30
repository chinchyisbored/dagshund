import type { ReferenceResolution } from "../types/reference-resolution.ts";
import { buildPrefixedNodeId, extractResourceType } from "../utils/resource-key.ts";
import { extractStateField, parseThreePartName } from "./extract-resource-state.ts";
import type { ReferenceResolutionContext } from "./reference-resolution-context.ts";

export const resolveVolumeReference = (
  sourceResourceKey: string,
  fullName: string,
  context: ReferenceResolutionContext,
): ReferenceResolution => {
  const parsed = parseThreePartName(fullName);
  if (parsed === undefined) return { kind: "absent", sourceResourceKey };
  const volumeKey = context.entries.find(
    ([key, entry]) =>
      extractResourceType(key) === "volumes" &&
      (extractStateField(entry, "full_name") === fullName ||
        (extractStateField(entry, "catalog_name") === parsed.catalog &&
          extractStateField(entry, "schema_name") === parsed.schema &&
          extractStateField(entry, "name") === parsed.table)),
  )?.[0];
  const targetNodeId =
    volumeKey === undefined
      ? undefined
      : context.identityCatalog.nodeIdByResourceKey.get(volumeKey);
  if (volumeKey !== undefined && targetNodeId !== undefined)
    return {
      kind: "resolved",
      sourceResourceKey,
      targetNodeId,
      targetResourceKey: volumeKey,
      provenance: "real",
      direction: "entry-to-target",
    };
  const phantomId = buildPrefixedNodeId("volume", fullName);
  return {
    kind: "phantom",
    sourceResourceKey,
    targetNodeId: phantomId,
    resourceKey: phantomId,
    label: parsed.table,
    phantomKind: "volume",
    placement: { kind: "hierarchy", identity: fullName, tier: 2 },
    direction: "entry-to-target",
  };
};
