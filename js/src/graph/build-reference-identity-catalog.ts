import type { PlanEntry } from "../types/plan-schema.ts";
import type { PreparedPlan } from "../types/prepared-plan.ts";
import type { ReferenceIdentityCatalog } from "../types/reference-resolution.ts";
import { buildPrefixedNodeId, extractResourceType } from "../utils/resource-key.ts";
import { extractStateField, parseThreePartName } from "./extract-resource-state.ts";
import {
  extractBundleResourceIdRef,
  formatPostgresBranchIdentity,
  formatPostgresRoleIdentity,
  parsePostgresBranchPath,
  parsePostgresProjectPath,
  parsePostgresRolePath,
} from "./postgres-paths.ts";
import {
  CONVENTIONAL_REFERENCE_SPECS,
  type ReferenceIndexes,
  TASK_REF_SPECS,
} from "./reference-specs.ts";

const extractHierarchyIdentity = (
  resourceType: string,
  entry: PlanEntry,
  resourceKey: string,
  preparedPlan: PreparedPlan,
  postgresBranchIdentities: ReadonlyMap<string, string>,
): string | undefined => {
  switch (resourceType) {
    case "catalogs":
    case "database_catalogs":
      return extractStateField(entry, "name");
    case "postgres_catalogs": {
      const fields = preparedPlan.byResourceKey.get(resourceKey)?.postgres;
      return fields?.status === "supported" ? fields.value["catalog_id"] : undefined;
    }
    case "schemas":
      return (() => {
        const catalog = extractStateField(entry, "catalog_name");
        const name = extractStateField(entry, "name");
        return catalog !== undefined && name !== undefined ? `${catalog}.${name}` : undefined;
      })();
    case "postgres_projects": {
      const fields = preparedPlan.byResourceKey.get(resourceKey)?.postgres;
      return fields?.status === "supported" ? fields.value["project_id"] : undefined;
    }
    case "postgres_branches":
      return postgresBranchIdentities.get(resourceKey);
    case "postgres_roles": {
      const fields = preparedPlan.byResourceKey.get(resourceKey)?.postgres;
      if (fields?.status !== "supported") return undefined;
      const namePath = fields.value["name"];
      const parsedName = namePath === undefined ? undefined : parsePostgresRolePath(namePath);
      if (parsedName !== undefined) return formatPostgresRoleIdentity(parsedName);
      const roleId = fields.value["role_id"];
      const parent = fields.value["parent"];
      const branchPath = parent === undefined ? undefined : parsePostgresBranchPath(parent);
      return roleId !== undefined && branchPath !== undefined
        ? `${formatPostgresBranchIdentity(branchPath)}/${roleId}`
        : undefined;
    }
    case "postgres_databases": {
      const fields = preparedPlan.byResourceKey.get(resourceKey)?.postgres;
      if (fields?.status !== "supported") return undefined;
      const branch = fields.value["parent"] ?? fields.value["branch"];
      const database = fields.value["postgres_database"];
      if (branch === undefined || database === undefined) return undefined;
      const symbolicKey = extractBundleResourceIdRef(branch);
      const branchIdentity =
        symbolicKey !== undefined
          ? postgresBranchIdentities.get(symbolicKey)
          : (() => {
              const path = parsePostgresBranchPath(branch);
              return path === undefined ? undefined : formatPostgresBranchIdentity(path);
            })();
      return branchIdentity === undefined ? undefined : `${branchIdentity}/${database}`;
    }
    default:
      return undefined;
  }
};

const hierarchyNodeId = (resourceType: string, identity: string): string => {
  if (
    resourceType === "catalogs" ||
    resourceType === "database_catalogs" ||
    resourceType === "postgres_catalogs"
  )
    return buildPrefixedNodeId("catalog", identity);
  if (resourceType === "schemas") return buildPrefixedNodeId("schema", identity);
  if (resourceType === "postgres_projects") return buildPrefixedNodeId("postgresProject", identity);
  if (resourceType === "postgres_branches") return buildPrefixedNodeId("postgresBranch", identity);
  if (resourceType === "postgres_databases")
    return buildPrefixedNodeId("postgresDatabase", identity);
  return identity;
};

export const buildReferenceIdentityCatalog = (
  entries: readonly (readonly [string, PlanEntry])[],
  indexes: ReferenceIndexes,
  preparedPlan: PreparedPlan,
): ReferenceIdentityCatalog => {
  const nodeIdByResourceKey = new Map(entries.map(([key]) => [key, key]));
  const resourceKeyByAlias = new Map<string, string>();
  const nodeIdByAlias = new Map<string, string>();
  const postgresBranchIdentityByResourceKey = new Map<string, string>();
  const postgresDatabaseIdentityByResourceKey = new Map<string, string>();
  const postgresDatabaseResourceKeyByBranchRef = new Map<string, string>();
  const postgresResourceKeyByIdentity = new Map<string, string>();
  for (const [resourceKey] of entries) {
    if (extractResourceType(resourceKey) !== "postgres_branches") continue;
    const fields = preparedPlan.byResourceKey.get(resourceKey)?.postgres;
    if (fields?.status !== "supported") continue;
    const branchId = fields.value["branch_id"];
    const parent = fields.value["parent"];
    const project = parent === undefined ? undefined : parsePostgresProjectPath(parent);
    if (branchId !== undefined && project !== undefined) {
      postgresBranchIdentityByResourceKey.set(resourceKey, `${project}/${branchId}`);
    }
  }
  for (const [resourceKey, entry] of entries) {
    const resourceType = extractResourceType(resourceKey);
    if (resourceType === undefined) continue;
    const preparedPostgres = preparedPlan.byResourceKey.get(resourceKey)?.postgres;
    if (resourceType === "postgres_databases" && preparedPostgres?.status === "supported") {
      const branchRef = preparedPostgres.value["parent"] ?? preparedPostgres.value["branch"];
      const database = preparedPostgres.value["postgres_database"];
      if (branchRef !== undefined && database !== undefined) {
        postgresDatabaseResourceKeyByBranchRef.set(`${branchRef}\u0000${database}`, resourceKey);
      }
    }
    const identity = extractHierarchyIdentity(
      resourceType,
      entry,
      resourceKey,
      preparedPlan,
      postgresBranchIdentityByResourceKey,
    );
    if (identity !== undefined) {
      const usesHierarchyNodeId =
        resourceType === "catalogs" ||
        resourceType === "database_catalogs" ||
        resourceType === "postgres_catalogs" ||
        resourceType === "postgres_projects";
      const nodeId = usesHierarchyNodeId ? hierarchyNodeId(resourceType, identity) : resourceKey;
      nodeIdByResourceKey.set(resourceKey, nodeId);
      resourceKeyByAlias.set(`${resourceType}:${identity}`, resourceKey);
      nodeIdByAlias.set(`${resourceType}:${identity}`, nodeId);
      if (resourceType === "postgres_branches") {
        postgresBranchIdentityByResourceKey.set(resourceKey, identity);
        postgresResourceKeyByIdentity.set(`branch:${identity}`, resourceKey);
      }
      if (resourceType === "postgres_databases") {
        postgresDatabaseIdentityByResourceKey.set(resourceKey, identity);
        postgresResourceKeyByIdentity.set(`database:${identity}`, resourceKey);
      }
      if (resourceType === "postgres_roles") {
        postgresResourceKeyByIdentity.set(`role:${identity}`, resourceKey);
      }
    }
  }
  for (const [resourceKey, entry] of entries) {
    if (extractResourceType(resourceKey) === "schemas") {
      const catalog = extractStateField(entry, "catalog_name");
      const name = extractStateField(entry, "name");
      if (catalog !== undefined && name !== undefined) {
        const alias = `schemas:${catalog}.${name}`;
        resourceKeyByAlias.set(alias, resourceKey);
        nodeIdByAlias.set(alias, nodeIdByResourceKey.get(resourceKey) ?? resourceKey);
      }
    }
    if (extractResourceType(resourceKey) === "synced_database_tables") {
      const name = extractStateField(entry, "name");
      const catalog = extractStateField(entry, "catalog_name");
      const schema = extractStateField(entry, "schema_name");
      const identity =
        name !== undefined && parseThreePartName(name) !== undefined
          ? name
          : name !== undefined && catalog !== undefined && schema !== undefined
            ? `${catalog}.${schema}.${name}`
            : name;
      if (identity !== undefined) {
        const alias = `sourceTable:${identity}`;
        resourceKeyByAlias.set(alias, resourceKey);
        nodeIdByAlias.set(alias, nodeIdByResourceKey.get(resourceKey) ?? resourceKey);
      }
    }
  }
  for (const spec of Object.values(CONVENTIONAL_REFERENCE_SPECS)) {
    for (const [alias, resourceKey] of spec.selectIndex(indexes)) {
      if (!nodeIdByResourceKey.has(resourceKey)) continue;
      const aliasKey = `${spec.targetResourceType}:${alias}`;
      resourceKeyByAlias.set(aliasKey, resourceKey);
      nodeIdByAlias.set(aliasKey, nodeIdByResourceKey.get(resourceKey) ?? resourceKey);
    }
  }
  for (const spec of TASK_REF_SPECS) {
    for (const [alias, resourceKey] of spec.selectIndex(indexes)) {
      if (!nodeIdByResourceKey.has(resourceKey)) continue;
      const aliasKey = `${spec.targetResourceType}:${alias}`;
      resourceKeyByAlias.set(aliasKey, resourceKey);
      nodeIdByAlias.set(aliasKey, nodeIdByResourceKey.get(resourceKey) ?? resourceKey);
    }
  }
  for (const [alias, target] of indexes.pipelineIndex) {
    const aliasKey = `pipelines:${alias}`;
    if (nodeIdByResourceKey.has(target)) {
      resourceKeyByAlias.set(aliasKey, target);
      nodeIdByAlias.set(aliasKey, nodeIdByResourceKey.get(target) ?? target);
    } else {
      nodeIdByAlias.delete(aliasKey);
      resourceKeyByAlias.delete(aliasKey);
      nodeIdByAlias.set(aliasKey, target);
    }
  }
  return {
    nodeIdByResourceKey,
    resourceKeyByAlias,
    nodeIdByAlias,
    postgresBranchIdentityByResourceKey,
    postgresDatabaseIdentityByResourceKey,
    postgresDatabaseResourceKeyByBranchRef,
    postgresResourceKeyByIdentity,
  };
};
