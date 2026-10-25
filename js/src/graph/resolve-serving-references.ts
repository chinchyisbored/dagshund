import type { ReferenceResolution } from "../types/reference-resolution.ts";
import {
  buildPrefixedNodeId,
  buildResourceKey,
  extractResourceType,
} from "../utils/resource-key.ts";
import { extractStateField, parseThreePartName } from "./extract-resource-state.ts";
import type { ReferenceResolutionContext } from "./reference-resolution-context.ts";

export const resolveServingModelReferences = (
  sourceResourceKey: string,
  context: ReferenceResolutionContext,
): readonly ReferenceResolution[] => {
  if (extractResourceType(sourceResourceKey) === "model_serving_endpoints") {
    const names = context.preparedPlan.byResourceKey.get(sourceResourceKey)?.servedEntityNames;
    if (names?.status === "supported") {
      return names.value.flatMap((name): ReferenceResolution[] => {
        const targetKey =
          context.indexes.registeredModelFullNameIndex.get(name) ??
          context.entries.find(
            ([key]) => key === buildResourceKey("registered_models", name),
          )?.[0] ??
          context.entries.find(
            ([key, entry]) =>
              extractResourceType(key) === "registered_models" &&
              extractStateField(entry, "full_name") === name,
          )?.[0] ??
          context.entries.find(
            ([key, entry]) =>
              extractResourceType(key) === "registered_models" &&
              extractStateField(entry, "name") === name,
          )?.[0];
        const targetNodeId =
          targetKey === undefined
            ? undefined
            : context.identityCatalog.nodeIdByResourceKey.get(targetKey);
        if (targetNodeId !== undefined)
          return [
            {
              kind: "resolved",
              sourceResourceKey,
              targetNodeId,
              targetResourceKey: targetKey,
              provenance: "real",
              direction: "entry-to-target",
            },
          ];
        if (parseThreePartName(name) === undefined) return [];
        const phantomId = buildPrefixedNodeId("registeredModel", name);
        return [
          {
            kind: "phantom",
            sourceResourceKey,
            targetNodeId: phantomId,
            resourceKey: phantomId,
            label: name.split(".").at(-1) ?? name,
            phantomKind: "registeredModel",
            placement: { kind: "hierarchy", identity: name, tier: 2 },
            direction: "entry-to-target",
          },
        ];
      });
    }
  }
  return [];
};
