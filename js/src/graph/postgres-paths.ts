export type PostgresBranchPath = {
  readonly projectId: string;
  readonly branchId: string;
};

export type PostgresRolePath = PostgresBranchPath & {
  readonly roleId: string;
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

export const resolvePostgresBranchRefIdentity = (branchRef: string): string | undefined => {
  const branchPath = parsePostgresBranchPath(branchRef);
  return branchPath === undefined ? undefined : formatPostgresBranchIdentity(branchPath);
};

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

/** Extract a DAB resource-key reference from "${resources.type.name.id}" or ".name". */
export const extractBundleResourceIdRef = (resourceRef: string): string | undefined => {
  const match = /^\$\{(resources\.[^.]+\.[^.]+)\.(?:id|name)\}$/.exec(resourceRef);
  return match?.[1];
};
