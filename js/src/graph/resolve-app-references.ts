import type { ReferenceResolution } from "../types/reference-resolution.ts";
import {
  buildPrefixedNodeId,
  buildResourceKey,
  extractResourceType,
  type PhantomKind,
} from "../utils/resource-key.ts";
import { buildDerivedNodeId } from "./derived-node-specs.ts";
import { extractStateField, parseThreePartName } from "./extract-resource-state.ts";
import {
  extractBundleResourceIdRef,
  formatPostgresBranchIdentity,
  parsePostgresBranchPath,
  parsePostgresDatabasePath,
} from "./postgres-paths.ts";
import type { ReferenceResolutionContext } from "./reference-resolution-context.ts";
import { resolvePostgresCatalogDatabaseReference } from "./resolve-postgres-references.ts";
import { findPromotedSourceTable } from "./resolve-uc-table-references.ts";
import { resolveVolumeReference } from "./resolve-volume-reference.ts";

export const resolveAppReferences = (
  sourceResourceKey: string,
  context: ReferenceResolutionContext,
): readonly ReferenceResolution[] => {
  const projection = context.preparedPlan.byResourceKey.get(sourceResourceKey)?.appResources;
  if (projection?.status !== "supported") return [];
  const existingResourceKeys = new Set(context.entries.map(([key]) => key));
  return projection.value.flatMap<ReferenceResolution>((ref) => {
    if (ref.kind === "uc_securable") {
      if (ref.securableType === "TABLE") {
        const symbolicKey = extractBundleResourceIdRef(ref.fullName);
        if (symbolicKey !== undefined) {
          if (
            extractResourceType(symbolicKey) !== "vector_search_indexes" ||
            !context.identityCatalog.nodeIdByResourceKey.has(symbolicKey)
          )
            return [];
          const targetNodeId = context.identityCatalog.nodeIdByResourceKey.get(symbolicKey);
          return targetNodeId === undefined
            ? []
            : [
                {
                  kind: "resolved",
                  sourceResourceKey,
                  targetNodeId,
                  targetResourceKey: symbolicKey,
                  provenance: "real",
                  direction: "entry-to-target",
                },
              ];
        }
        if (parseThreePartName(ref.fullName) === undefined) return [];
        const promoted = findPromotedSourceTable(ref.fullName, context);
        const alias = `sourceTable:${ref.fullName}`;
        const targetNodeId =
          (promoted === undefined
            ? undefined
            : buildDerivedNodeId(promoted.derivedKind, promoted.identity)) ??
          context.identityCatalog.nodeIdByAlias.get(alias) ??
          context.identityCatalog.nodeIdByAlias.get(`vectorSearchIndex:${ref.fullName}`);
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
        if (ref.securableType === "VOLUME")
          return [resolveVolumeReference(sourceResourceKey, ref.fullName, context)];
        const phantomKind = "function";
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
      case "postgres": {
        const branchKey = extractBundleResourceIdRef(ref.branch);
        const databaseKey = extractBundleResourceIdRef(ref.database);
        const branchIdentity =
          branchKey === undefined
            ? (() => {
                const segments = ref.branch.split("/");
                const path =
                  segments.length === 4 && !ref.branch.includes("${")
                    ? parsePostgresBranchPath(ref.branch)
                    : undefined;
                return path === undefined ? undefined : formatPostgresBranchIdentity(path);
              })()
            : extractResourceType(branchKey) === "postgres_branches"
              ? context.identityCatalog.postgresBranchIdentityByResourceKey.get(branchKey)
              : undefined;
        if (
          databaseKey !== undefined &&
          extractResourceType(databaseKey) === "postgres_databases" &&
          existingResourceKeys.has(databaseKey)
        ) {
          const databaseFields = context.preparedPlan.byResourceKey.get(databaseKey)?.postgres;
          const databaseBranch =
            databaseFields?.status === "supported"
              ? (databaseFields.value["parent"] ?? databaseFields.value["branch"])
              : undefined;
          const databaseBranchKey =
            databaseBranch === undefined ? undefined : extractBundleResourceIdRef(databaseBranch);
          const databaseBranchIdentity =
            databaseBranch === undefined
              ? undefined
              : databaseBranchKey === undefined
                ? (() => {
                    const path = parsePostgresBranchPath(databaseBranch);
                    return path === undefined ? undefined : formatPostgresBranchIdentity(path);
                  })()
                : context.identityCatalog.postgresBranchIdentityByResourceKey.get(
                    databaseBranchKey,
                  );
          if (
            (branchKey !== undefined &&
              extractResourceType(branchKey) === "postgres_branches" &&
              existingResourceKeys.has(branchKey) &&
              databaseBranchKey === branchKey) ||
            (branchIdentity !== undefined && databaseBranchIdentity === branchIdentity)
          ) {
            return [
              {
                kind: "resolved",
                sourceResourceKey,
                targetNodeId:
                  context.identityCatalog.nodeIdByResourceKey.get(databaseKey) ?? databaseKey,
                targetResourceKey: databaseKey,
                provenance: "real",
                direction: "entry-to-target",
              },
            ];
          }
        }
        if (branchIdentity === undefined) return [];
        if (databaseKey !== undefined) {
          if (extractResourceType(databaseKey) !== "postgres_databases") return [];
          const identity =
            context.identityCatalog.postgresDatabaseIdentityByResourceKey.get(databaseKey);
          return identity?.startsWith(`${branchIdentity}/`) === true
            ? resolvePostgresCatalogDatabaseReference(
                sourceResourceKey,
                ref.branch,
                identity.slice(branchIdentity.length + 1),
                context,
              )
            : [];
        }
        const databasePath = parsePostgresDatabasePath(ref.database);
        if (
          databasePath === undefined ||
          ref.database.includes("${") ||
          formatPostgresBranchIdentity(databasePath) !== branchIdentity
        )
          return [];
        const managedDatabaseKey = context.entries.find(([key, entry]) => {
          if (extractResourceType(key) !== "postgres_databases") return false;
          const identity = context.identityCatalog.postgresDatabaseIdentityByResourceKey.get(key);
          return (
            identity?.startsWith(`${branchIdentity}/`) === true &&
            extractStateField(entry, "name") === ref.database
          );
        })?.[0];
        if (managedDatabaseKey !== undefined) {
          return [
            {
              kind: "resolved",
              sourceResourceKey,
              targetNodeId:
                context.identityCatalog.nodeIdByResourceKey.get(managedDatabaseKey) ??
                managedDatabaseKey,
              targetResourceKey: managedDatabaseKey,
              provenance: "real",
              direction: "entry-to-target",
            },
          ];
        }
        return resolvePostgresCatalogDatabaseReference(
          sourceResourceKey,
          ref.branch,
          databasePath.databaseId,
          context,
        );
      }
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
