import type { PlanEntry } from "../types/plan-schema.ts";
import type { PreparedPlan, Projection } from "../types/prepared-plan.ts";
import type { ReferenceIdentityCatalog } from "../types/reference-resolution.ts";
import { buildPrefixedNodeId, extractResourceType } from "../utils/resource-key.ts";
import { parseThreePartName, resolveUcLeafParentIdentity } from "./extract-resource-state.ts";
import {
  extractBundleResourceIdRef,
  formatPostgresBranchIdentity,
  parsePostgresBranchPath,
  parsePostgresProjectPath,
  resolvePostgresBranchRefIdentity,
} from "./postgres-paths.ts";

/** Parent identity at the preceding tier, at a named tier, or by real resource key. */
export type ParentRef =
  | { readonly kind: "parent-identity"; readonly identity: string }
  | { readonly kind: "tier-identity"; readonly identity: string; readonly tierIndex: number }
  | { readonly kind: "resource-key"; readonly resourceKey: string; readonly tierIndex: number };

const getCurrentStateField = (
  currentState: Projection<Readonly<Record<string, unknown>>>,
  field: string,
): string | undefined => {
  if (currentState.status !== "supported") return undefined;
  const value = currentState.value[field];
  return typeof value === "string" ? value : undefined;
};

const parentIdentityRef = (identity: string | undefined): ParentRef | undefined =>
  identity !== undefined ? { kind: "parent-identity", identity } : undefined;

const tierIdentityRef = (identity: string, tierIndex: number): ParentRef => ({
  kind: "tier-identity",
  identity,
  tierIndex,
});

const resourceKeyRef = (resourceKey: string, tierIndex: number): ParentRef => ({
  kind: "resource-key",
  resourceKey,
  tierIndex,
});

/** One tier in an ordered resource hierarchy. */
export type TierSpec = {
  readonly name: string;
  readonly resourceTypes: ReadonlySet<string>;
  readonly resolveIdentity: (
    currentState: Projection<Readonly<Record<string, unknown>>>,
    key: string,
    entries: readonly (readonly [string, PlanEntry])[],
  ) => string | undefined;
  readonly resolveParentRef: (
    currentState: Projection<Readonly<Record<string, unknown>>>,
    key: string,
    entries: readonly (readonly [string, PlanEntry])[],
  ) => ParentRef | undefined;
  readonly deriveParentRef?: (identity: string) => string | undefined;
  readonly buildHierarchyId: (identity: string) => string;
  readonly useHierarchyId?: boolean;
};

/** Root and ordered tiers for one hierarchy. */
export type ChainSpec = {
  readonly rootId: string;
  readonly rootLabel: string;
  readonly tiers: readonly TierSpec[];
};

const CATALOG_TIER_TYPES: ReadonlySet<string> = new Set([
  "catalogs",
  "database_catalogs",
  "postgres_catalogs",
]);
const SCHEMA_TIER_TYPES: ReadonlySet<string> = new Set(["schemas"]);
const UC_ROOT_LEAF_TYPES: ReadonlySet<string> = new Set(["external_locations"]);
const UC_LEAF_TIER_TYPES: ReadonlySet<string> = new Set([
  "volumes",
  "registered_models",
  "secrets",
  "synced_database_tables",
  "model_services",
  "mcp_services",
  "model_provider_services",
  "vector_search_indexes",
]);
const POSTGRES_PROJECT_TIER_TYPES: ReadonlySet<string> = new Set(["postgres_projects"]);
const POSTGRES_BRANCH_TIER_TYPES: ReadonlySet<string> = new Set(["postgres_branches"]);
const POSTGRES_BRANCH_CHILD_TIER_TYPES: ReadonlySet<string> = new Set([
  "postgres_databases",
  "postgres_endpoints",
  "postgres_roles",
  "postgres_snapshot_schedules",
]);
const POSTGRES_DATABASE_CHILD_TIER_TYPES: ReadonlySet<string> = new Set(["postgres_synced_tables"]);
const POSTGRES_RESOURCE_TYPES: ReadonlySet<string> = new Set([
  ...POSTGRES_PROJECT_TIER_TYPES,
  ...POSTGRES_BRANCH_TIER_TYPES,
  ...POSTGRES_BRANCH_CHILD_TIER_TYPES,
  ...POSTGRES_DATABASE_CHILD_TIER_TYPES,
]);

export const UC_CHAIN: ChainSpec = {
  rootId: "uc-root",
  rootLabel: "Unity Catalog",
  tiers: [
    {
      name: "catalog",
      resourceTypes: CATALOG_TIER_TYPES,
      resolveIdentity: (currentState, key) =>
        getCurrentStateField(
          currentState,
          extractResourceType(key) === "postgres_catalogs" ? "catalog_id" : "name",
        ),
      resolveParentRef: () => undefined,
      buildHierarchyId: (name) => buildPrefixedNodeId("catalog", name),
      useHierarchyId: true,
    },
    {
      name: "schema",
      resourceTypes: SCHEMA_TIER_TYPES,
      resolveIdentity: (currentState) => {
        const catalog = getCurrentStateField(currentState, "catalog_name");
        const name = getCurrentStateField(currentState, "name");
        return catalog !== undefined && name !== undefined ? `${catalog}.${name}` : undefined;
      },
      resolveParentRef: (currentState) =>
        parentIdentityRef(getCurrentStateField(currentState, "catalog_name")),
      deriveParentRef: (identity) => identity.split(".")[0],
      buildHierarchyId: (identity) => buildPrefixedNodeId("schema", identity),
    },
    {
      name: "leaf",
      resourceTypes: UC_LEAF_TIER_TYPES,
      resolveIdentity: () => undefined,
      resolveParentRef: (currentState, key) => {
        const type = extractResourceType(key);
        if (
          type === "model_services" ||
          type === "mcp_services" ||
          type === "model_provider_services"
        ) {
          const parent = getCurrentStateField(currentState, "parent");
          const match = parent?.match(/^schemas\/([^.]*)\.([^.]*)$/);
          return match === null || match === undefined
            ? undefined
            : parentIdentityRef(`${match[1]}.${match[2]}`);
        }
        const name = getCurrentStateField(currentState, "name");
        if (type === "vector_search_indexes") {
          const parsedVectorName = name === undefined ? undefined : parseThreePartName(name);
          if (parsedVectorName !== undefined) {
            return parentIdentityRef(`${parsedVectorName.catalog}.${parsedVectorName.schema}`);
          }
        }
        const parent = resolveUcLeafParentIdentity({
          catalog: getCurrentStateField(currentState, "catalog_name"),
          schema: getCurrentStateField(currentState, "schema_name"),
          name,
        });
        if (parent?.kind === "schema") return parentIdentityRef(parent.identity);
        if (extractResourceType(key) === "volumes") {
          const fullName = getCurrentStateField(currentState, "full_name");
          const parsed = fullName === undefined ? undefined : parseThreePartName(fullName);
          if (parsed !== undefined) {
            return parentIdentityRef(`${parsed.catalog}.${parsed.schema}`);
          }
        }
        return parent?.kind === "catalog" ? tierIdentityRef(parent.identity, 0) : undefined;
      },
      deriveParentRef: (identity) => {
        const parsed = parseThreePartName(identity);
        return parsed !== undefined ? `${parsed.catalog}.${parsed.schema}` : undefined;
      },
      buildHierarchyId: (identity) => buildPrefixedNodeId("sourceTable", identity),
    },
    {
      name: "UC root leaf",
      resourceTypes: UC_ROOT_LEAF_TYPES,
      resolveIdentity: () => undefined,
      resolveParentRef: () => undefined,
      buildHierarchyId: (identity) => identity,
    },
  ],
};

const resolvePostgresProjectParentRef = (parent: string): ParentRef | undefined => {
  const resourceKey = extractBundleResourceIdRef(parent);
  if (resourceKey !== undefined) {
    return extractResourceType(resourceKey) === "postgres_projects"
      ? resourceKeyRef(resourceKey, 0)
      : undefined;
  }
  return parentIdentityRef(parsePostgresProjectPath(parent));
};

const resolvePostgresBranchParentRef = (parent: string): ParentRef | undefined => {
  const resourceKey = extractBundleResourceIdRef(parent);
  if (resourceKey !== undefined) {
    return extractResourceType(resourceKey) === "postgres_branches"
      ? resourceKeyRef(resourceKey, 1)
      : undefined;
  }
  const branchPath = parsePostgresBranchPath(parent);
  return branchPath !== undefined
    ? parentIdentityRef(formatPostgresBranchIdentity(branchPath))
    : undefined;
};

const getPreparedPostgresField = (
  plan: PreparedPlan,
  key: string,
  field: string,
): string | undefined => {
  const projection = plan.byResourceKey.get(key)?.postgres;
  return projection?.status === "supported" ? projection.value[field] : undefined;
};

export const POSTGRES_DATABASE_TIER_INDEX = 2;

export const createPostgresChain = (
  plan: PreparedPlan,
  entries: readonly (readonly [string, PlanEntry])[],
  identityCatalog: ReferenceIdentityCatalog,
): ChainSpec => {
  const resolveBranchIdentity = (key: string): string | undefined =>
    identityCatalog.postgresBranchIdentityByResourceKey.get(key);
  const resolveBranchRefIdentity = (branchRef: string): string | undefined => {
    const resourceKey = extractBundleResourceIdRef(branchRef);
    if (resourceKey !== undefined) return resolveBranchIdentity(resourceKey);
    return resolvePostgresBranchRefIdentity(branchRef);
  };
  const resolveDatabaseIdentity = (key: string): string | undefined =>
    identityCatalog.postgresDatabaseIdentityByResourceKey.get(key);
  return {
    rootId: "postgres-root",
    rootLabel: "Lakebase",
    tiers: [
      {
        name: "project",
        resourceTypes: POSTGRES_PROJECT_TIER_TYPES,
        resolveIdentity: (_entry, key) => getPreparedPostgresField(plan, key, "project_id"),
        resolveParentRef: () => undefined,
        buildHierarchyId: (name) => buildPrefixedNodeId("postgresProject", name),
        useHierarchyId: true,
      },
      {
        name: "branch",
        resourceTypes: POSTGRES_BRANCH_TIER_TYPES,
        resolveIdentity: (_entry, key) => resolveBranchIdentity(key),
        resolveParentRef: (_entry, key) => {
          const parent = getPreparedPostgresField(plan, key, "parent");
          return parent !== undefined ? resolvePostgresProjectParentRef(parent) : undefined;
        },
        deriveParentRef: (identity) => identity.split("/")[0],
        buildHierarchyId: (name) => buildPrefixedNodeId("postgresBranch", name),
      },
      {
        name: "branch child",
        resourceTypes: POSTGRES_BRANCH_CHILD_TIER_TYPES,
        resolveIdentity: (_entry, key) =>
          extractResourceType(key) === "postgres_databases"
            ? resolveDatabaseIdentity(key)
            : undefined,
        resolveParentRef: (_entry, key) => {
          const parent =
            getPreparedPostgresField(plan, key, "parent") ??
            getPreparedPostgresField(plan, key, "branch");
          return parent !== undefined ? resolvePostgresBranchParentRef(parent) : undefined;
        },
        deriveParentRef: (identity) => identity.split("/").slice(0, 2).join("/"),
        buildHierarchyId: (identity) => buildPrefixedNodeId("postgresDatabase", identity),
      },
      {
        name: "database child",
        resourceTypes: POSTGRES_DATABASE_CHILD_TIER_TYPES,
        resolveIdentity: () => undefined,
        resolveParentRef: (_entry, key) => {
          const branch = getPreparedPostgresField(plan, key, "branch");
          const database = getPreparedPostgresField(plan, key, "postgres_database");
          if (branch === undefined || database === undefined) return undefined;
          const target =
            identityCatalog.postgresDatabaseResourceKeyByBranchRef.get(
              `${branch}\u0000${database}`,
            ) ??
            entries.find(
              ([candidateKey]) =>
                extractResourceType(candidateKey) === "postgres_databases" &&
                resolveDatabaseIdentity(candidateKey) ===
                  `${resolveBranchRefIdentity(branch)}/${database}`,
            )?.[0];
          if (target !== undefined) return resourceKeyRef(target, POSTGRES_DATABASE_TIER_INDEX);
          const branchIdentity = resolveBranchRefIdentity(branch);
          return branchIdentity !== undefined
            ? tierIdentityRef(`${branchIdentity}/${database}`, POSTGRES_DATABASE_TIER_INDEX)
            : undefined;
        },
        buildHierarchyId: () => "",
      },
    ],
  };
};

export const isUnityCatalogType = (resourceType: string): boolean =>
  UC_CHAIN.tiers.some((tier) => tier.resourceTypes.has(resourceType));

export const isPostgresType = (resourceType: string): boolean =>
  POSTGRES_RESOURCE_TYPES.has(resourceType);
