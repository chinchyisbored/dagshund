/** Edge ID prefix that distinguishes lateral (cross-resource) edges from DAG edges. */
export const LATERAL_EDGE_PREFIX = "lateral::" as const;

/** Extract the short resource name from a resource key (last dot-segment). */
export const extractResourceName = (resourceKey: string): string => {
  const segments = resourceKey.split(".");
  return segments[segments.length - 1] ?? resourceKey;
};

/** Extract the resource type segment from a resource key (second dot-segment). */
export const extractResourceType = (key: string): string | undefined => key.split(".")[1];

/** Check whether a key represents a sub-resource (e.g. permissions, grants) rather than a top-level resource.
 *  Sub-resources have >3 dot segments like "resources.jobs.test_job.permissions". */
export const isSubResourceKey = (key: string): boolean => key.split(".").length > 3;

/** Extract the parent resource key (first 3 dot-segments) from a sub-resource key.
 *  "resources.jobs.test_job.permissions" → "resources.jobs.test_job" */
export const extractParentResourceKey = (key: string): string =>
  key.split(".").slice(0, 3).join(".");

/** Extract the sub-resource suffix (segments from index 3) from a sub-resource key.
 *  "resources.jobs.test_job.permissions" → "permissions" */
export const extractSubResourceSuffix = (key: string): string => key.split(".").slice(3).join(".");

type PhantomPrefixSpec = {
  readonly prefix: string;
  readonly badge: string;
  readonly leaf: boolean;
  readonly resourceType: string | undefined;
};

const PHANTOM_PREFIX_SPECS = {
  catalog: { prefix: "catalog::", badge: "catalog", leaf: false, resourceType: undefined },
  schema: { prefix: "schema::", badge: "schema", leaf: false, resourceType: undefined },
  sourceTable: { prefix: "source-table::", badge: "table", leaf: true, resourceType: undefined },
  databaseInstance: {
    prefix: "database-instance::",
    badge: "database instance",
    leaf: true,
    resourceType: "database_instances",
  },
  secretScope: {
    prefix: "secret-scope::",
    badge: "secret",
    leaf: true,
    resourceType: "secret_scopes",
  },
  servingEndpoint: {
    prefix: "serving-endpoint::",
    badge: "serving",
    leaf: true,
    resourceType: "model_serving_endpoints",
  },
  job: { prefix: "job::", badge: "job", leaf: true, resourceType: "jobs" },
  sqlWarehouse: {
    prefix: "sql-warehouse::",
    badge: "warehouse",
    leaf: true,
    resourceType: "sql_warehouses",
  },
  genieSpace: {
    prefix: "genie-space::",
    badge: "genie",
    leaf: true,
    resourceType: "genie_spaces",
  },
  dashboard: {
    prefix: "dashboard::",
    badge: "dashboard",
    leaf: true,
    resourceType: "dashboards",
  },
  experiment: {
    prefix: "experiment::",
    badge: "experiment",
    leaf: true,
    resourceType: "experiments",
  },
  pipeline: { prefix: "pipeline::", badge: "pipeline", leaf: true, resourceType: "pipelines" },
  registeredModel: {
    prefix: "registered-model::",
    badge: "model",
    leaf: true,
    resourceType: undefined,
  },
  postgresProject: {
    prefix: "postgres-project::",
    badge: "postgres project",
    leaf: false,
    resourceType: undefined,
  },
  postgresBranch: {
    prefix: "postgres-branch::",
    badge: "postgres branch",
    leaf: false,
    resourceType: undefined,
  },
  postgresDatabase: {
    prefix: "postgres-database::",
    badge: "postgres database",
    leaf: false,
    resourceType: undefined,
  },
} as const satisfies Readonly<Record<string, PhantomPrefixSpec>>;

export type PhantomKind = keyof typeof PHANTOM_PREFIX_SPECS;

const PHANTOM_PREFIX_VALUES: readonly PhantomPrefixSpec[] = Object.values(PHANTOM_PREFIX_SPECS);

/** Build a prefixed node ID for a registered phantom or hierarchy-container kind. */
export const buildPrefixedNodeId = (kind: PhantomKind, identity: string): string =>
  `${PHANTOM_PREFIX_SPECS[kind].prefix}${identity}`;

/** Build a top-level Databricks bundle resource key. */
export const buildResourceKey = (collection: string, name: string): string =>
  `resources.${collection}.${name}`;

/** Build the node ID for a task within a job resource. */
export const buildTaskNodeId = (resourceKey: string, taskKey: string): string =>
  `${resourceKey}::${taskKey}`;

/** Extract the resource node ID from a task node ID built by buildTaskNodeId. */
export const extractTaskNodeParentId = (nodeId: string): string => {
  const separator = nodeId.indexOf("::");
  return separator === -1 ? nodeId : nodeId.substring(0, separator);
};

/** Derive a type badge for phantom nodes from their ID or resource key.
 *  Checks `::` prefixed IDs first, then falls through to the standard resource type badge. */
export const extractPhantomBadge = (resourceKey: string): string | undefined =>
  PHANTOM_PREFIX_VALUES.find((spec) => resourceKey.startsWith(spec.prefix))?.badge ??
  extractTypeBadge(resourceKey);

/** Resolve the normalized resource type represented by a workspace phantom ID. */
export const extractPhantomResourceType = (nodeId: string): string | undefined =>
  PHANTOM_PREFIX_VALUES.find((spec) => nodeId.startsWith(spec.prefix))?.resourceType;

/** Check whether a node ID represents an inferred leaf phantom (not a hierarchy phantom).
 *  Containers with useHierarchyId share the `::` ID grammar with phantoms.
 *  Real flat resources use `resources.type.name`. */
export const isPhantomLeaf = (nodeId: string): boolean =>
  PHANTOM_PREFIX_VALUES.some((spec) => spec.leaf && nodeId.startsWith(spec.prefix));

/** Resource types that reference database instances (used by both phantom collector and lateral edge spec). */
export const DATABASE_INSTANCE_SOURCE_TYPES: ReadonlySet<string> = new Set([
  "synced_database_tables",
  "database_catalogs",
]);

/** Synced-table resource types that may reference an existing pipeline. */
export const SYNCED_TABLE_SOURCE_TYPES: ReadonlySet<string> = new Set([
  "postgres_synced_tables",
  "synced_database_tables",
]);

/** Top-level resource types that carry a `warehouse_id` state field.
 *  Used by both the lateral edge spec and the phantom collector. */
export const WAREHOUSE_SOURCE_TYPES: ReadonlySet<string> = new Set([
  "alerts",
  "dashboards",
  "genie_spaces",
  "quality_monitors",
]);

/** Job task sub-object keys that can carry a `warehouse_id` field.
 *  Used by both the lateral edge spec and the phantom collector. */
export const TASK_WAREHOUSE_KEYS: readonly string[] = [
  "sql_task",
  "dashboard_task",
  "alert_task",
  "dbt_task",
  "notebook_task",
  "power_bi_task",
];

/** Map resource type segment to a short display badge. */
const RESOURCE_TYPE_BADGES: Readonly<Record<string, string>> = {
  schemas: "schema",
  volumes: "volume",
  registered_models: "model",
  catalogs: "catalog",
  database_catalogs: "database catalog",
  postgres_catalogs: "postgres catalog",
  database_instances: "database instance",
  dashboards: "dashboard",
  genie_spaces: "genie",
  alerts: "alert",
  apps: "app",
  experiments: "experiment",
  external_locations: "external location",
  jobs: "job",
  models: "mlflow",
  pipelines: "pipeline",
  clusters: "cluster",
  model_serving_endpoints: "serving",
  postgres_branches: "postgres branch",
  postgres_databases: "postgres database",
  postgres_endpoints: "postgres endpoint",
  postgres_projects: "postgres project",
  postgres_roles: "postgres role",
  postgres_synced_tables: "postgres synced table",
  quality_monitors: "monitor",
  sql_warehouses: "warehouse",
  secret_scopes: "secret",
  secrets: "secret",
  synced_database_tables: "synced database table",
};

/** Derive a human-readable type badge from a resource key like "resources.schemas.analytics". */
export const extractTypeBadge = (resourceKey: string): string | undefined => {
  const typeSegment = extractResourceType(resourceKey);
  return typeSegment !== undefined ? (RESOURCE_TYPE_BADGES[typeSegment] ?? typeSegment) : undefined;
};
