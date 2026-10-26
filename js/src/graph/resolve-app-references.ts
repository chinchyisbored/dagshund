import type { ReferenceResolution } from "../types/reference-resolution.ts";
import {
  buildPrefixedNodeId,
  buildResourceKey,
  extractResourceType,
  type PhantomKind,
} from "../utils/resource-key.ts";
import { buildDerivedNodeId } from "./derived-node-specs.ts";
import { extractStateField, parseThreePartName } from "./extract-resource-state.ts";
import { extractBundleResourceIdRef } from "./postgres-paths.ts";
import type { ReferenceResolutionContext } from "./reference-resolution-context.ts";
import { findPromotedSourceTable } from "./resolve-uc-table-references.ts";

export const resolveAppReferences = (
  sourceResourceKey: string,
  context: ReferenceResolutionContext,
): readonly ReferenceResolution[] => {
  const projection = context.preparedPlan.byResourceKey.get(sourceResourceKey)?.appResources;
  if (projection?.status !== "supported") return [];
  const existingResourceKeys = new Set(context.entries.map(([key]) => key));
  return projection.value.flatMap<ReferenceResolution>((ref) => {
    if (ref.kind === "uc_securable") {
      if (ref.securableType === "TABLE" && parseThreePartName(ref.fullName) !== undefined) {
        const promoted = findPromotedSourceTable(ref.fullName, context);
        const alias = `sourceTable:${ref.fullName}`;
        const targetNodeId =
          (promoted === undefined
            ? undefined
            : buildDerivedNodeId(promoted.derivedKind, promoted.identity)) ??
          context.identityCatalog.nodeIdByAlias.get(alias);
        if (targetNodeId !== undefined) {
          return [
            {
              kind: "resolved",
              sourceResourceKey,
              targetNodeId,
              targetResourceKey: context.identityCatalog.resourceKeyByAlias.get(alias),
              provenance: promoted === undefined ? "real" : "derived",
              direction: "entry-to-target",
            },
          ];
        }
        const phantomId = buildPrefixedNodeId("sourceTable", ref.fullName);
        return [
          {
            kind: "phantom",
            sourceResourceKey,
            targetNodeId: phantomId,
            resourceKey: phantomId,
            label: ref.fullName.split(".").at(-1) ?? ref.fullName,
            phantomKind: "sourceTable",
            placement: { kind: "hierarchy", identity: ref.fullName, tier: 2 },
            direction: "entry-to-target",
          },
        ];
      }
      if (ref.securableType === "VOLUME" || ref.securableType === "FUNCTION") {
        const parsed = parseThreePartName(ref.fullName);
        if (parsed === undefined) return [];
        if (ref.securableType === "VOLUME") {
          const volumeKey = context.entries.find(
            ([key, entry]) =>
              extractResourceType(key) === "volumes" &&
              (extractStateField(entry, "full_name") === ref.fullName ||
                (extractStateField(entry, "catalog_name") === parsed.catalog &&
                  extractStateField(entry, "schema_name") === parsed.schema &&
                  extractStateField(entry, "name") === parsed.table)),
          )?.[0];
          const nodeId =
            volumeKey === undefined
              ? undefined
              : context.identityCatalog.nodeIdByResourceKey.get(volumeKey);
          if (volumeKey !== undefined && nodeId !== undefined) {
            return [
              {
                kind: "resolved",
                sourceResourceKey,
                targetNodeId: nodeId,
                targetResourceKey: volumeKey,
                provenance: "real",
                direction: "entry-to-target",
              },
            ];
          }
        }
        const phantomKind = ref.securableType === "VOLUME" ? "volume" : "function";
        const nodeId = buildPrefixedNodeId(phantomKind, ref.fullName);
        return [
          {
            kind: "phantom",
            sourceResourceKey,
            targetNodeId: nodeId,
            resourceKey: nodeId,
            label: parsed.table,
            phantomKind,
            placement: { kind: "hierarchy", identity: ref.fullName, tier: 2 },
            direction: "entry-to-target",
          },
        ];
      }
      return [];
    }
    const resolveNamedTarget = (
      targetKey: string | undefined,
      phantomKind: PhantomKind,
      label: string,
      resourceType: string,
      phantomResourceKey?: string,
    ): readonly ReferenceResolution[] => {
      const targetNodeId =
        targetKey === undefined
          ? undefined
          : context.identityCatalog.nodeIdByResourceKey.get(targetKey);
      if (targetKey !== undefined && targetNodeId !== undefined) {
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
      }
      const phantomId = buildPrefixedNodeId(phantomKind, label);
      if (targetKey !== undefined && existingResourceKeys.has(targetKey)) return [];
      return [
        {
          kind: "phantom",
          sourceResourceKey,
          targetNodeId: phantomId,
          resourceKey: phantomResourceKey ?? targetKey ?? phantomId,
          label,
          phantomKind,
          placement: { kind: "workspace-resource", resourceType },
          direction: "entry-to-target",
        },
      ];
    };
    switch (ref.kind) {
      case "job":
        return resolveNamedTarget(context.indexes.jobIndex.get(ref.id), "job", ref.id, "jobs");
      case "sql_warehouse":
        return resolveNamedTarget(
          context.indexes.warehouseIndex.get(ref.id),
          "sqlWarehouse",
          ref.id,
          "sql_warehouses",
        );
      case "genie_space": {
        const bundleRef = extractBundleResourceIdRef(ref.id);
        if (bundleRef !== undefined)
          return extractResourceType(bundleRef) === "genie_spaces" &&
            context.identityCatalog.nodeIdByResourceKey.has(bundleRef)
            ? resolveNamedTarget(bundleRef, "genieSpace", ref.name, "genie_spaces")
            : [];
        const nameKey = buildResourceKey("genie_spaces", ref.name);
        const targetKey = existingResourceKeys.has(nameKey)
          ? nameKey
          : context.indexes.genieSpaceIndex.get(ref.id);
        return resolveNamedTarget(targetKey, "genieSpace", ref.name, "genie_spaces", nameKey);
      }
      case "experiment":
        return resolveNamedTarget(
          context.indexes.experimentIndex.get(ref.id),
          "experiment",
          ref.id,
          "experiments",
        );
      case "secret_scope":
        return resolveNamedTarget(
          buildResourceKey("secret_scopes", ref.name),
          "secretScope",
          ref.name,
          "secret_scopes",
          buildResourceKey("secret_scopes", ref.name),
        );
      case "serving_endpoint":
        return resolveNamedTarget(
          buildResourceKey("model_serving_endpoints", ref.name),
          "servingEndpoint",
          ref.name,
          "model_serving_endpoints",
          buildResourceKey("model_serving_endpoints", ref.name),
        );
    }
    const exhaustive: never = ref;
    return exhaustive;
  });
};
