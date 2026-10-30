import type { ReferenceResolution } from "../types/reference-resolution.ts";
import { buildPrefixedNodeId, extractResourceType } from "../utils/resource-key.ts";
import {
  extractBundleResourceIdRef,
  formatPostgresBranchIdentity,
  formatPostgresRoleIdentity,
  parsePostgresBranchPath,
  parsePostgresRolePath,
} from "./postgres-paths.ts";
import type { ReferenceResolutionContext } from "./reference-resolution-context.ts";

export const resolvePostgresCatalogDatabaseReference = (
  sourceResourceKey: string,
  branchRef: string | undefined,
  database: string | undefined,
  context: ReferenceResolutionContext,
): readonly ReferenceResolution[] => {
  if (branchRef === undefined || database === undefined) return [];
  const symbolicKey = extractBundleResourceIdRef(branchRef);
  const identity =
    symbolicKey === undefined
      ? (() => {
          const path = parsePostgresBranchPath(branchRef);
          return path === undefined ? undefined : formatPostgresBranchIdentity(path);
        })()
      : context.identityCatalog.postgresBranchIdentityByResourceKey.get(symbolicKey);
  const databaseIdentity = identity === undefined ? undefined : `${identity}/${database}`;
  const databaseKey =
    (databaseIdentity === undefined
      ? undefined
      : context.identityCatalog.postgresResourceKeyByIdentity.get(
          `database:${databaseIdentity}`,
        )) ??
    context.identityCatalog.postgresDatabaseResourceKeyByBranchRef.get(
      `${branchRef}\u0000${database}`,
    );
  if (databaseKey !== undefined) {
    return [
      {
        kind: "resolved",
        sourceResourceKey,
        targetNodeId: context.identityCatalog.nodeIdByResourceKey.get(databaseKey) ?? databaseKey,
        targetResourceKey: databaseKey,
        provenance: "real",
        direction: "entry-to-target",
      },
    ];
  }
  if (databaseIdentity === undefined) return [];
  const targetNodeId = buildPrefixedNodeId("postgresDatabase", databaseIdentity);
  return [
    {
      kind: "phantom",
      sourceResourceKey,
      targetNodeId,
      resourceKey: targetNodeId,
      label: database,
      phantomKind: "postgresDatabase",
      placement: { kind: "hierarchy", identity: databaseIdentity, tier: 2 },
      direction: "entry-to-target",
    },
  ];
};

const resolvePostgresBranchLineageReference = (
  sourceResourceKey: string,
  reference: string | undefined,
  context: ReferenceResolutionContext,
): readonly ReferenceResolution[] => {
  if (reference === undefined) return [];
  const symbolicKey = extractBundleResourceIdRef(reference);
  const path = parsePostgresBranchPath(reference);
  const identity =
    symbolicKey === undefined
      ? path === undefined
        ? undefined
        : formatPostgresBranchIdentity(path)
      : context.identityCatalog.postgresBranchIdentityByResourceKey.get(symbolicKey);
  const targetKey =
    symbolicKey !== undefined && extractResourceType(symbolicKey) === "postgres_branches"
      ? symbolicKey
      : identity === undefined
        ? undefined
        : context.identityCatalog.postgresResourceKeyByIdentity.get(`branch:${identity}`);
  if (targetKey !== undefined && context.identityCatalog.nodeIdByResourceKey.has(targetKey)) {
    return [
      {
        kind: "resolved",
        sourceResourceKey,
        targetNodeId: context.identityCatalog.nodeIdByResourceKey.get(targetKey) ?? targetKey,
        targetResourceKey: targetKey,
        provenance: "real",
        direction: "entry-to-target",
      },
    ];
  }
  if (identity === undefined) return [];
  const targetNodeId = buildPrefixedNodeId("postgresBranch", identity);
  return [
    {
      kind: "phantom",
      sourceResourceKey,
      targetNodeId,
      resourceKey: targetNodeId,
      label: identity.split("/").at(-1) ?? identity,
      phantomKind: "postgresBranch",
      placement: { kind: "hierarchy", identity, tier: 1 },
      direction: "entry-to-target",
    },
  ];
};

const resolvePostgresDatabaseRoleReference = (
  sourceResourceKey: string,
  reference: string | undefined,
  context: ReferenceResolutionContext,
): readonly ReferenceResolution[] => {
  if (reference === undefined) return [];
  const symbolicKey = extractBundleResourceIdRef(reference);
  const path = parsePostgresRolePath(reference);
  const identity = path === undefined ? undefined : formatPostgresRoleIdentity(path);
  const targetKey =
    symbolicKey !== undefined && extractResourceType(symbolicKey) === "postgres_roles"
      ? symbolicKey
      : identity === undefined
        ? undefined
        : context.identityCatalog.postgresResourceKeyByIdentity.get(`role:${identity}`);
  if (targetKey === undefined) return [];
  return [
    {
      kind: "resolved",
      sourceResourceKey,
      targetNodeId: context.identityCatalog.nodeIdByResourceKey.get(targetKey) ?? targetKey,
      targetResourceKey: targetKey,
      provenance: "real",
      direction: "entry-to-target",
    },
  ];
};

export const resolvePostgresReferences = (
  sourceResourceKey: string,
  context: ReferenceResolutionContext,
): readonly ReferenceResolution[] => {
  const type = extractResourceType(sourceResourceKey);
  const fields = context.preparedPlan.byResourceKey.get(sourceResourceKey)?.postgres;
  if (fields?.status !== "supported") return [];
  const values = fields.value;
  if (type === "postgres_catalogs") {
    return resolvePostgresCatalogDatabaseReference(
      sourceResourceKey,
      values["branch"] ?? values["parent"],
      values["postgres_database"],
      context,
    );
  }
  if (type === "postgres_branches") {
    return resolvePostgresBranchLineageReference(
      sourceResourceKey,
      values["source_branch"],
      context,
    );
  }
  if (type === "postgres_databases") {
    return resolvePostgresDatabaseRoleReference(sourceResourceKey, values["role"], context);
  }
  return [];
};
