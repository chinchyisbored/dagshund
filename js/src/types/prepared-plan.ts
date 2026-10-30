import type { NormalizedPlan } from "../utils/normalize-plan.ts";

export type PreparationDiagnostic = {
  readonly resourceKey: string;
  readonly capability:
    | "current-state"
    | "serving-endpoint-models"
    | "job-tasks"
    | "job-clusters"
    | "job-file-arrival"
    | "warehouse-reference"
    | "instance-pool-reference"
    | "app-resources"
    | "source-table-reference"
    | "vector-index-references"
    | "pipeline-ingestion-schemas"
    | "pipeline-event-log"
    | "synced-table-output"
    | "existing-pipeline-reference"
    | "postgres-identity"
    | "external-location-credential"
    | "postgres-synced-table-configured-inputs"
    | "ai-gateway-references";
  readonly reason: "invalid-shape";
};

export type Projection<T> =
  | { readonly status: "absent" }
  | { readonly status: "supported"; readonly value: T }
  | { readonly status: "unsupported"; readonly diagnostic: PreparationDiagnostic };

export type PreparedResource = {
  readonly currentState: Projection<Readonly<Record<string, unknown>>>;
  readonly servedEntityNames: Projection<readonly string[]>;
  readonly job: Projection<import("../preparation/prepare-job.ts").PreparedJob>;
  readonly warehouseId: Projection<string>;
  readonly instancePoolReferences: Projection<readonly string[]>;
  readonly appResources: Projection<
    readonly import("../preparation/prepare-app.ts").AppResourceRef[]
  >;
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
  readonly aiGatewayReferences: Projection<
    import("../preparation/prepare-ai-gateway.ts").AiGatewayReferences
  >;
};

export type PreparedPlan = {
  readonly normalized: NormalizedPlan;
  readonly byResourceKey: ReadonlyMap<string, PreparedResource>;
  readonly diagnostics: readonly PreparationDiagnostic[];
};
