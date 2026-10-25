import type { ReferenceResolution } from "../types/reference-resolution.ts";
import { buildPrefixedNodeId, extractResourceType } from "../utils/resource-key.ts";
import {
  buildDerivedNodeId,
  DERIVED_NODE_SPECS,
  extractPromotedPhantomKind,
} from "./derived-node-specs.ts";
import { parseThreePartName } from "./extract-resource-state.ts";
import type { ReferenceResolutionContext } from "./reference-resolution-context.ts";

export const findPromotedSourceTable = (
  identity: string,
  context: ReferenceResolutionContext,
):
  | { readonly derivedKind: keyof typeof DERIVED_NODE_SPECS; readonly identity: string }
  | undefined =>
  Object.keys(DERIVED_NODE_SPECS).flatMap((kind) =>
    context.entries.flatMap(([key]) =>
      (context.ownedDerivedRefs.get(key) ?? []).filter(
        (owned) =>
          owned.derivedKind === kind &&
          owned.identity === identity &&
          extractPromotedPhantomKind(owned.derivedKind) === "sourceTable",
      ),
    ),
  )[0];

export const resolveSourceTableReference = (
  sourceResourceKey: string,
  context: ReferenceResolutionContext,
): readonly ReferenceResolution[] => {
  const resourceType = extractResourceType(sourceResourceKey);
  const prepared = context.preparedPlan.byResourceKey.get(sourceResourceKey);
  const ownedOutputs = context.ownedDerivedRefs.get(sourceResourceKey) ?? [];
  const sourceTable =
    resourceType === "synced_database_tables" || resourceType === "postgres_synced_tables"
      ? prepared?.sourceTableFullName
      : undefined;
  const monitorTable =
    resourceType === "quality_monitors" ? prepared?.qualityMonitorTableName : undefined;
  const tableName =
    sourceTable?.status === "supported"
      ? sourceTable.value
      : monitorTable?.status === "supported"
        ? monitorTable.value
        : undefined;
  if (tableName !== undefined && parseThreePartName(tableName) !== undefined) {
    const realKey = context.identityCatalog.resourceKeyByAlias.get(`sourceTable:${tableName}`);
    if (realKey === sourceResourceKey) return [];
    const realNodeId = context.identityCatalog.nodeIdByAlias.get(`sourceTable:${tableName}`);
    const derivedRef = findPromotedSourceTable(tableName, context);
    if (ownedOutputs.some((output) => output.identity === tableName)) return [];
    const derivedNodeId =
      derivedRef === undefined ? undefined : buildDerivedNodeId(derivedRef.derivedKind, tableName);
    if (realNodeId !== undefined || derivedNodeId !== undefined) {
      return [
        {
          kind: "resolved",
          sourceResourceKey,
          targetNodeId: derivedNodeId ?? realNodeId ?? "",
          ...(derivedNodeId === undefined && realKey !== undefined
            ? { targetResourceKey: realKey }
            : {}),
          provenance: derivedNodeId === undefined ? "real" : "derived",
          direction: "entry-to-target",
        },
      ];
    }
    const targetNodeId = buildPrefixedNodeId("sourceTable", tableName);
    return [
      {
        kind: "phantom",
        sourceResourceKey,
        targetNodeId,
        resourceKey: targetNodeId,
        label: tableName.split(".").at(-1) ?? tableName,
        phantomKind: "sourceTable",
        placement: { kind: "hierarchy", identity: tableName, tier: 2 },
        direction: "entry-to-target",
      },
    ];
  }

  return [];
};
