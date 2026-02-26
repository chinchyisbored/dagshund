/** Extract the short resource name from a resource key (last dot-segment). */
export const extractResourceName = (resourceKey: string): string => {
  const segments = resourceKey.split(".");
  return segments[segments.length - 1] ?? resourceKey;
};

/** Extract the resource type segment from a resource key (second dot-segment). */
export const extractResourceType = (key: string): string | undefined => key.split(".")[1];

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
