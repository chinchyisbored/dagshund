import { extractResourceState } from "../graph/extract-resource-state.ts";
import type { PlanEntry } from "../types/plan-schema.ts";
import type { PreparationDiagnostic, Projection } from "../types/prepared-plan.ts";
import { extractResourceType } from "../utils/resource-key.ts";
import { getUnknownProp, isUnknownRecord } from "../utils/unknown-record.ts";
import { preparePostgresSyncedTableInputs } from "./prepare-postgres-synced-table-inputs.ts";

type PreparedReferences = {
  readonly sourceTableFullName: Projection<string>;
  readonly qualityMonitorTableName: Projection<string>;
  readonly qualityMonitorBaselineTableName: Projection<string>;
  readonly vectorIndex: Projection<
    Readonly<{ endpointName: string; sourceTable: string; embeddingEndpoints: readonly string[] }>
  >;
  readonly pipelineIngestionSchemas: Projection<readonly string[]>;
  readonly pipelineEventLog: Projection<
    Readonly<{ catalog: string; schema: string; name: string }>
  >;
  readonly pipelineOutputId: Projection<string>;
  readonly existingPipelineId: Projection<string>;
  readonly syncedTableId: Projection<string>;
  readonly postgres: Projection<Readonly<Record<string, string>>>;
  readonly externalLocationCredentialName: Projection<string>;
  readonly diagnostics: readonly PreparationDiagnostic[];
};

const supported = <T>(value: T): Projection<T> => ({ status: "supported", value });
const absent = { status: "absent" } as const;

const extractPipelineOutputId = (state: unknown): string | undefined => {
  const candidates = [
    getUnknownProp(state, "pipeline_id"),
    getUnknownProp(getUnknownProp(state, "status"), "pipeline_id"),
  ];
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const normalized = candidate.trim();
    if (normalized !== "" && !normalized.startsWith("${")) return normalized;
  }
  return undefined;
};

const unsupported = (
  resourceKey: string,
  capability: PreparationDiagnostic["capability"],
): Projection<never> => ({
  status: "unsupported",
  diagnostic: { resourceKey, capability, reason: "invalid-shape" },
});

/** Prepare only specialized reference/output fields consumed by graph construction. */
export const prepareResourceReferences = (
  resourceKey: string,
  entry: PlanEntry,
): PreparedReferences => {
  const resourceType = extractResourceType(resourceKey);
  const state = extractResourceState(entry);
  const configuredInputs = preparePostgresSyncedTableInputs(resourceKey, entry);
  const diagnostics: PreparationDiagnostic[] = [...configuredInputs.diagnostics];
  let sourceTableFullName: Projection<string> = absent;
  let qualityMonitorTableName: Projection<string> = absent;
  let qualityMonitorBaselineTableName: Projection<string> = absent;
  let vectorIndex: PreparedReferences["vectorIndex"] = absent;
  let pipelineIngestionSchemas: Projection<readonly string[]> = absent;
  let pipelineEventLog: PreparedReferences["pipelineEventLog"] = absent;
  let pipelineOutputId: Projection<string> = absent;
  let existingPipelineId: Projection<string> = absent;
  let syncedTableId: Projection<string> = absent;
  let postgres: PreparedReferences["postgres"] = absent;
  let externalLocationCredentialName: Projection<string> = absent;

  if (
    state !== undefined &&
    resourceType === "external_locations" &&
    Object.hasOwn(state, "credential_name")
  ) {
    externalLocationCredentialName =
      typeof state["credential_name"] === "string"
        ? supported(state["credential_name"])
        : unsupported(resourceKey, "external-location-credential");
  }

  if (
    state !== undefined &&
    (resourceType === "postgres_synced_tables" || resourceType === "synced_database_tables")
  ) {
    const spec = state["spec"];
    if (spec !== undefined && !isUnknownRecord(spec)) {
      sourceTableFullName = unsupported(resourceKey, "source-table-reference");
    } else {
      const value =
        state["source_table_full_name"] ??
        (isUnknownRecord(spec) ? spec["source_table_full_name"] : undefined);
      if (value !== undefined) {
        sourceTableFullName =
          typeof value === "string"
            ? supported(value)
            : unsupported(resourceKey, "source-table-reference");
      }
    }
    if (resourceType === "postgres_synced_tables") {
      const output = state["synced_table_id"];
      if (output !== undefined)
        syncedTableId =
          typeof output === "string"
            ? supported(output)
            : unsupported(resourceKey, "synced-table-output");
    }
  }

  if (state !== undefined && resourceType === "quality_monitors") {
    for (const [field, assign] of [
      [
        "table_name",
        (projection: Projection<string>) => {
          qualityMonitorTableName = projection;
        },
      ],
      [
        "baseline_table_name",
        (projection: Projection<string>) => {
          qualityMonitorBaselineTableName = projection;
        },
      ],
    ] as const) {
      if (!Object.hasOwn(state, field)) continue;
      const value = state[field];
      assign(
        typeof value === "string" && value.trim() !== ""
          ? supported(value)
          : unsupported(resourceKey, "source-table-reference"),
      );
    }
  }

  if (state !== undefined && resourceType === "vector_search_indexes") {
    const spec = state["delta_sync_index_spec"];
    if (!isUnknownRecord(spec)) {
      const endpointName = state["endpoint_name"];
      vectorIndex =
        !Object.hasOwn(state, "delta_sync_index_spec") &&
        typeof endpointName === "string" &&
        endpointName.trim() !== ""
          ? supported({ endpointName, sourceTable: "", embeddingEndpoints: [] })
          : unsupported(resourceKey, "vector-index-references");
    } else {
      const endpointName = state["endpoint_name"];
      const sourceTable = spec["source_table"];
      const columns = spec["embedding_source_columns"];
      const endpoints = Array.isArray(columns)
        ? columns.flatMap((column) => {
            if (!isUnknownRecord(column)) return [];
            return [
              column["embedding_model_endpoint_name"],
              column["model_endpoint_name_for_query"],
            ].filter((value): value is string => typeof value === "string");
          })
        : [];
      const validColumns =
        columns === undefined ||
        (Array.isArray(columns) &&
          columns.every(
            (column) =>
              isUnknownRecord(column) &&
              ["embedding_model_endpoint_name", "model_endpoint_name_for_query"].every(
                (field) =>
                  column[field] === undefined ||
                  (typeof column[field] === "string" && column[field].trim() !== ""),
              ),
          ));
      vectorIndex =
        typeof endpointName === "string" &&
        endpointName.trim() !== "" &&
        typeof sourceTable === "string" &&
        sourceTable.trim() !== "" &&
        validColumns &&
        (columns === undefined || Array.isArray(columns))
          ? supported({ endpointName, sourceTable, embeddingEndpoints: [...new Set(endpoints)] })
          : unsupported(resourceKey, "vector-index-references");
    }
  }

  if (
    state !== undefined &&
    (resourceType === "postgres_synced_tables" || resourceType === "synced_database_tables")
  ) {
    const candidates = [
      state["existing_pipeline_id"],
      getUnknownProp(state["spec"], "existing_pipeline_id"),
    ];
    let malformed = false;
    for (const candidate of candidates) {
      if (candidate === undefined) continue;
      if (typeof candidate !== "string") {
        malformed = true;
        continue;
      }
      const normalized = candidate.trim();
      if (normalized !== "") {
        existingPipelineId = supported(normalized);
        break;
      }
    }
    if (existingPipelineId.status === "absent" && malformed) {
      existingPipelineId = unsupported(resourceKey, "existing-pipeline-reference");
    }
  }

  if (resourceType === "pipelines" || resourceType === "postgres_synced_tables") {
    const currentOutput = extractPipelineOutputId(getUnknownProp(entry.new_state, "value"));
    const historicalOutput = extractPipelineOutputId(entry.remote_state);
    const output = currentOutput ?? historicalOutput;
    if (output !== undefined) pipelineOutputId = supported(output);
  }

  if (state !== undefined && resourceType === "pipelines") {
    const hasIngestion = Object.hasOwn(state, "ingestion_definition");
    if (hasIngestion) {
      const definition = state["ingestion_definition"];
      const objects = isUnknownRecord(definition) ? definition["objects"] : undefined;
      if (!isUnknownRecord(definition) || !Array.isArray(objects)) {
        pipelineIngestionSchemas = unsupported(resourceKey, "pipeline-ingestion-schemas");
      } else {
        const names: string[] = [];
        let invalid = false;
        for (const object of objects) {
          if (!isUnknownRecord(object)) {
            invalid = true;
            break;
          }
          if (!Object.hasOwn(object, "schema")) continue;
          const schema = object["schema"];
          if (!isUnknownRecord(schema)) {
            invalid = true;
            break;
          }
          const catalog = schema["source_catalog"];
          const name = schema["source_schema"];
          if (typeof catalog !== "string" || typeof name !== "string") {
            invalid = true;
            break;
          }
          names.push(`${catalog}.${name}`);
        }
        pipelineIngestionSchemas = invalid
          ? unsupported(resourceKey, "pipeline-ingestion-schemas")
          : supported(names);
      }
    }
    if (Object.hasOwn(state, "event_log")) {
      const eventLog = state["event_log"];
      const catalog = isUnknownRecord(eventLog) ? eventLog["catalog"] : undefined;
      const schema = isUnknownRecord(eventLog) ? eventLog["schema"] : undefined;
      const name = isUnknownRecord(eventLog) ? eventLog["name"] : undefined;
      pipelineEventLog =
        typeof catalog === "string" && typeof schema === "string" && typeof name === "string"
          ? supported({ catalog, schema, name })
          : unsupported(resourceKey, "pipeline-event-log");
    }
  }

  if (
    state !== undefined &&
    [
      "postgres_projects",
      "postgres_branches",
      "postgres_databases",
      "postgres_endpoints",
      "postgres_catalogs",
      "postgres_roles",
      "postgres_synced_tables",
      "postgres_snapshot_schedules",
    ].includes(resourceType ?? "")
  ) {
    const fieldsByType: Readonly<Record<string, readonly string[]>> = {
      postgres_projects: ["project_id"],
      postgres_branches: ["branch_id", "parent", "source_branch"],
      postgres_databases: ["parent", "branch", "postgres_database", "role"],
      postgres_endpoints: ["parent"],
      postgres_catalogs: ["branch", "postgres_database", "catalog_id"],
      postgres_roles: ["parent", "role_id", "name"],
      postgres_synced_tables: ["branch", "postgres_database"],
      postgres_snapshot_schedules: ["branch"],
    };
    const fields = fieldsByType[resourceType ?? ""] ?? [];
    const values: Record<string, string> = {};
    let invalid = false;
    for (const field of fields) {
      const status = isUnknownRecord(state["status"]) ? state["status"] : undefined;
      const hasDirectValue = Object.hasOwn(state, field);
      const value =
        state[field] ?? (field === "postgres_database" ? status?.["postgres_database"] : undefined);
      if (!hasDirectValue && value === undefined) continue;
      if (typeof value !== "string") {
        invalid = true;
        break;
      }
      values[field] = value;
    }
    postgres = invalid ? unsupported(resourceKey, "postgres-identity") : supported(values);
  }

  const sourceSpec = state?.["spec"];
  const hasCurrentSourceField =
    state !== undefined &&
    (Object.hasOwn(state, "source_table_full_name") ||
      (isUnknownRecord(sourceSpec) && Object.hasOwn(sourceSpec, "source_table_full_name")));
  if (
    sourceTableFullName.status === "absent" &&
    !hasCurrentSourceField &&
    configuredInputs.sourceTableFullName.status !== "absent"
  ) {
    sourceTableFullName = configuredInputs.sourceTableFullName;
  }
  if (configuredInputs.postgres.status === "supported" && postgres.status === "supported") {
    const configuredPostgres = configuredInputs.postgres.value;
    const currentPostgres = postgres.value;
    postgres = supported({
      ...Object.fromEntries(
        Object.entries(configuredPostgres).filter(
          ([field]) => !Object.hasOwn(currentPostgres, field),
        ),
      ),
      ...currentPostgres,
    });
  }

  for (const projection of [
    sourceTableFullName,
    qualityMonitorTableName,
    pipelineIngestionSchemas,
    pipelineEventLog,
    syncedTableId,
    existingPipelineId,
    postgres,
    externalLocationCredentialName,
    qualityMonitorBaselineTableName,
    vectorIndex,
  ]) {
    if (projection.status === "unsupported") diagnostics.push(projection.diagnostic);
  }
  return {
    sourceTableFullName,
    qualityMonitorTableName,
    qualityMonitorBaselineTableName,
    vectorIndex,
    pipelineIngestionSchemas,
    pipelineEventLog,
    pipelineOutputId,
    existingPipelineId,
    syncedTableId,
    postgres,
    externalLocationCredentialName,
    diagnostics: [
      ...new Map(
        diagnostics.map((diagnostic) => [
          `${diagnostic.resourceKey}:${diagnostic.capability}`,
          diagnostic,
        ]),
      ).values(),
    ],
  };
};
