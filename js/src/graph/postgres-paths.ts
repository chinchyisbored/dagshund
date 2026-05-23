import type { PlanEntry } from "../types/plan-schema.ts";
import { extractResourceType } from "../utils/resource-key.ts";
import { extractStateField } from "./extract-resource-state.ts";

export type PostgresBranchPath = {
  readonly projectId: string;
  readonly branchId: string;
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

/** Extract a DAB resource-key reference from "${resources.type.name.id}". */
export const extractBundleResourceIdRef = (resourceRef: string): string | undefined => {
  const match = /^\$\{(resources\.[^.]+\.[^.]+)\.id\}$/.exec(resourceRef);
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
