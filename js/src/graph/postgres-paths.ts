import type { PlanEntry } from "../types/plan-schema.ts";
import { extractResourceType } from "../utils/resource-key.ts";
import { getUnknownProp } from "../utils/unknown-record.ts";
import { extractResourceState, extractStateField } from "./extract-resource-state.ts";

export type PostgresBranchPath = {
  readonly projectId: string;
  readonly branchId: string;
};

export type PostgresRolePath = PostgresBranchPath & {
  readonly roleId: string;
};

export type PostgresDatabaseIdentity = PostgresBranchPath & {
  readonly postgresDatabase: string;
};

export const parsePostgresProjectPath = (resourcePath: string): string | undefined => {
  const segments = resourcePath.split("/");
  const projectId = segments[1];
  return segments.length >= 2 && segments[0] === "projects" && projectId !== ""
    ? projectId
    : undefined;
};

export const parsePostgresBranchPath = (resourcePath: string): PostgresBranchPath | undefined => {
  const segments = resourcePath.split("/");
  const projectId = segments[1];
  const branchId = segments[3];
  if (
    segments.length < 4 ||
    segments[0] !== "projects" ||
    segments[2] !== "branches" ||
    projectId === undefined ||
    projectId === "" ||
    branchId === undefined ||
    branchId === ""
  ) {
    return undefined;
  }
  return { projectId, branchId };
};

export const formatPostgresBranchIdentity = (path: PostgresBranchPath): string =>
  `${path.projectId}/${path.branchId}`;

export const parsePostgresRolePath = (resourcePath: string): PostgresRolePath | undefined => {
  const segments = resourcePath.split("/");
  const projectId = segments[1];
  const branchId = segments[3];
  const roleId = segments[5];
  if (
    segments.length < 6 ||
    segments[0] !== "projects" ||
    segments[2] !== "branches" ||
    segments[4] !== "roles" ||
    projectId === undefined ||
    projectId === "" ||
    branchId === undefined ||
    branchId === "" ||
    roleId === undefined ||
    roleId === ""
  ) {
    return undefined;
  }
  return { projectId, branchId, roleId };
};

export const formatPostgresRoleIdentity = (path: PostgresRolePath): string =>
  `${path.projectId}/${path.branchId}/${path.roleId}`;

export const formatPostgresDatabaseIdentity = (identity: PostgresDatabaseIdentity): string =>
  `${identity.projectId}/${identity.branchId}/${identity.postgresDatabase}`;

/** Extract a DAB resource-key reference from "${resources.type.name.id}" or ".name". */
export const extractBundleResourceIdRef = (resourceRef: string): string | undefined => {
  const match = /^\$\{(resources\.[^.]+\.[^.]+)\.(?:id|name)\}$/.exec(resourceRef);
  return match?.[1];
};

export const resolvePostgresBranchIdentity = (entry: PlanEntry): string | undefined => {
  const branchId = extractStateField(entry, "branch_id");
  if (branchId === undefined) return undefined;
  const parent = extractStateField(entry, "parent");
  const projectId = parent !== undefined ? parsePostgresProjectPath(parent) : undefined;
  return projectId !== undefined ? `${projectId}/${branchId}` : undefined;
};

export const resolvePostgresBranchRefIdentity = (branchRef: string): string | undefined => {
  const branchPath = parsePostgresBranchPath(branchRef);
  return branchPath !== undefined ? formatPostgresBranchIdentity(branchPath) : undefined;
};

export const resolvePostgresBranchResourceKey = (
  branchRef: string,
  entries: readonly (readonly [string, PlanEntry])[],
): string | undefined => {
  const resourceKey = extractBundleResourceIdRef(branchRef);
  if (resourceKey !== undefined) {
    return extractResourceType(resourceKey) === "postgres_branches" ? resourceKey : undefined;
  }

  const branchIdentity = resolvePostgresBranchRefIdentity(branchRef);
  if (branchIdentity === undefined) return undefined;
  return entries.find(
    ([key, entry]) =>
      extractResourceType(key) === "postgres_branches" &&
      resolvePostgresBranchIdentity(entry) === branchIdentity,
  )?.[0];
};

export const resolvePostgresBranchRefIdentityFromEntries = (
  branchRef: string,
  entries: readonly (readonly [string, PlanEntry])[],
): string | undefined => {
  const resourceKey = resolvePostgresBranchResourceKey(branchRef, entries);
  if (resourceKey !== undefined) {
    const branchEntry = entries.find(([key]) => key === resourceKey)?.[1];
    return branchEntry !== undefined ? resolvePostgresBranchIdentity(branchEntry) : undefined;
  }
  return resolvePostgresBranchRefIdentity(branchRef);
};

export const extractPostgresDatabaseName = (entry: PlanEntry): string | undefined => {
  const directName = extractStateField(entry, "postgres_database");
  if (directName !== undefined) return directName;

  const state = extractResourceState(entry);
  const statusName = getUnknownProp(state?.["status"], "postgres_database");
  return typeof statusName === "string" ? statusName : undefined;
};

const extractPostgresDatabaseBranchRef = (entry: PlanEntry): string | undefined =>
  extractStateField(entry, "parent") ?? extractStateField(entry, "branch");

export const resolvePostgresDatabaseIdentity = (
  entry: PlanEntry,
  entries: readonly (readonly [string, PlanEntry])[],
): string | undefined => {
  const postgresDatabase = extractPostgresDatabaseName(entry);
  if (postgresDatabase === undefined) return undefined;
  const branchRef = extractPostgresDatabaseBranchRef(entry);
  if (branchRef === undefined) return undefined;
  const branchIdentity = resolvePostgresBranchRefIdentityFromEntries(branchRef, entries);
  return branchIdentity !== undefined ? `${branchIdentity}/${postgresDatabase}` : undefined;
};

export const resolvePostgresDatabaseResourceKey = (
  branchRef: string,
  postgresDatabase: string,
  entries: readonly (readonly [string, PlanEntry])[],
): string | undefined => {
  const targetIdentity = resolvePostgresBranchRefIdentityFromEntries(branchRef, entries);
  return entries.find(([key, entry]) => {
    if (extractResourceType(key) !== "postgres_databases") return false;
    if (extractPostgresDatabaseName(entry) !== postgresDatabase) return false;
    if (targetIdentity === undefined) {
      return extractPostgresDatabaseBranchRef(entry) === branchRef;
    }
    return (
      resolvePostgresDatabaseIdentity(entry, entries) === `${targetIdentity}/${postgresDatabase}`
    );
  })?.[0];
};

export const resolvePostgresRoleIdentity = (entry: PlanEntry): string | undefined => {
  const name = extractStateField(entry, "name");
  const namePath = name !== undefined ? parsePostgresRolePath(name) : undefined;
  if (namePath !== undefined) return formatPostgresRoleIdentity(namePath);

  const roleId = extractStateField(entry, "role_id");
  if (roleId === undefined) return undefined;
  const parent = extractStateField(entry, "parent");
  const branchPath = parent !== undefined ? parsePostgresBranchPath(parent) : undefined;
  return branchPath !== undefined
    ? `${formatPostgresBranchIdentity(branchPath)}/${roleId}`
    : undefined;
};

export const resolvePostgresRoleRefIdentity = (roleRef: string): string | undefined => {
  const rolePath = parsePostgresRolePath(roleRef);
  return rolePath !== undefined ? formatPostgresRoleIdentity(rolePath) : undefined;
};

export const resolvePostgresRoleResourceKey = (
  roleRef: string,
  entries: readonly (readonly [string, PlanEntry])[],
): string | undefined => {
  const resourceKey = extractBundleResourceIdRef(roleRef);
  if (resourceKey !== undefined) {
    return extractResourceType(resourceKey) === "postgres_roles" ? resourceKey : undefined;
  }

  const roleIdentity = resolvePostgresRoleRefIdentity(roleRef);
  if (roleIdentity === undefined) return undefined;
  return entries.find(
    ([key, entry]) =>
      extractResourceType(key) === "postgres_roles" &&
      resolvePostgresRoleIdentity(entry) === roleIdentity,
  )?.[0];
};
