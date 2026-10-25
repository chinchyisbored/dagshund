import type { NormalizedPlan } from "../utils/normalize-plan.ts";

export type PreparationDiagnostic = {
  readonly resourceKey: string;
  readonly capability:
    | "current-state"
    | "serving-endpoint-models"
    | "job-tasks"
    | "job-clusters"
    | "warehouse-reference"
    | "instance-pool-reference"
    | "app-resources"
    | "source-table-reference"
    | "pipeline-ingestion-schemas"
    | "pipeline-event-log"
    | "synced-table-output"
    | "existing-pipeline-reference"
    | "postgres-identity";
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
  readonly pipelineIngestionSchemas: Projection<readonly string[]>;
  readonly pipelineEventLog: Projection<
    Readonly<{ catalog: string; schema: string; name: string }>
  >;
  readonly pipelineOutputId: Projection<string>;
  readonly existingPipelineId: Projection<string>;
  readonly syncedTableId: Projection<string>;
  readonly postgres: Projection<Readonly<Record<string, string>>>;
};

export type PreparedPlan = {
  readonly normalized: NormalizedPlan;
  readonly byResourceKey: ReadonlyMap<string, PreparedResource>;
  readonly diagnostics: readonly PreparationDiagnostic[];
};
