/** Extract the short resource name from a resource key (last dot-segment). */
export const extractResourceName = (resourceKey: string): string => {
  const segments = resourceKey.split(".");
  return segments[segments.length - 1] ?? resourceKey;
};

/** Extract the resource type segment from a resource key (second dot-segment). */
export const extractResourceType = (key: string): string | undefined => key.split(".")[1];

/** Derive a type badge for phantom nodes from their ID or resource key.
 *  Checks `::` prefixed IDs first, then falls through to the standard resource type badge. */
export const extractPhantomBadge = (resourceKey: string): string | undefined => {
  if (resourceKey.startsWith("catalog::")) return "catalog";
  if (resourceKey.startsWith("schema::")) return "schema";
  if (resourceKey.startsWith("source-table::")) return "table";
  if (resourceKey.startsWith("database-instance::")) return "database instance";
  if (resourceKey.startsWith("secret-scope::")) return "secret";
  if (resourceKey.startsWith("serving-endpoint::")) return "serving";
  if (resourceKey.startsWith("job::")) return "job";
  if (resourceKey.startsWith("sql-warehouse::")) return "warehouse";
  if (resourceKey.startsWith("experiment::")) return "experiment";
  if (resourceKey.startsWith("postgres-project::")) return "postgres project";
  if (resourceKey.startsWith("postgres-branch::")) return "postgres branch";
  return extractTypeBadge(resourceKey);
};

/** Phantom leaf prefixes: inferred reference targets (not structural hierarchy). */
const PHANTOM_LEAF_PREFIXES: readonly string[] = [
  "source-table::",
  "database-instance::",
  "secret-scope::",
  "serving-endpoint::",
  "job::",
  "sql-warehouse::",
  "experiment::",
];

/** Check whether a node ID represents an inferred leaf phantom (not a hierarchy phantom).
 *  Convention: only phantom nodes use `::` prefixed IDs; real resources use `resources.type.name`. */
export const isPhantomLeaf = (nodeId: string): boolean =>
  PHANTOM_LEAF_PREFIXES.some((prefix) => nodeId.startsWith(prefix));

/** Resource types that reference database instances (used by both phantom collector and lateral edge spec). */
export const DATABASE_INSTANCE_SOURCE_TYPES: ReadonlySet<string> = new Set([
  "synced_database_tables",
  "database_catalogs",
]);

/** Map resource type segment to a short display badge. */
const RESOURCE_TYPE_BADGES: Readonly<Record<string, string>> = {
  schemas: "schema",
  volumes: "volume",
  registered_models: "model",
  catalogs: "catalog",
  database_catalogs: "database catalog",
  database_instances: "database instance",
  dashboards: "dashboard",
  genie_spaces: "genie",
  apps: "app",
  experiments: "experiment",
  external_locations: "external location",
  jobs: "job",
  models: "mlflow",
  pipelines: "pipeline",
  clusters: "cluster",
  model_serving_endpoints: "serving",
  postgres_branches: "postgres branch",
  postgres_endpoints: "postgres endpoint",
  postgres_projects: "postgres project",
  quality_monitors: "monitor",
  sql_warehouses: "warehouse",
  secret_scopes: "secret",
  synced_database_tables: "synced database table",
};

/** Derive a human-readable type badge from a resource key like "resources.schemas.analytics". */
export const extractTypeBadge = (resourceKey: string): string | undefined => {
  const typeSegment = extractResourceType(resourceKey);
  return typeSegment !== undefined ? (RESOURCE_TYPE_BADGES[typeSegment] ?? typeSegment) : undefined;
};
