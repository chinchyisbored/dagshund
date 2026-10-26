import type { PreparationDiagnostic } from "../types/prepared-plan.ts";

const CAPABILITY_MESSAGES = {
  "current-state": "Resource state could not be interpreted.",
  "app-resources": "App resource references could not be interpreted.",
  "serving-endpoint-models": "Serving endpoint model references could not be interpreted.",
  "job-tasks": "Job task data could not be interpreted.",
  "job-clusters": "Job cluster references could not be interpreted.",
  "warehouse-reference": "Warehouse reference could not be interpreted.",
  "instance-pool-reference": "Instance pool references could not be interpreted.",
  "source-table-reference": "Source table references could not be interpreted.",
  "vector-index-references": "Vector index references could not be interpreted.",
  "pipeline-ingestion-schemas": "Pipeline ingestion schema references could not be interpreted.",
  "pipeline-event-log": "Pipeline event log output could not be interpreted.",
  "synced-table-output": "Synced table output could not be interpreted.",
  "existing-pipeline-reference": "Existing pipeline reference could not be interpreted.",
  "postgres-identity": "Lakebase resource identity or relationship could not be interpreted.",
  "external-location-credential":
    "External location storage credential reference could not be interpreted.",
  "ai-gateway-references": "AI Gateway references could not be interpreted.",
} as const;

export function PreparationDiagnostics({
  diagnostics,
}: {
  readonly diagnostics: readonly PreparationDiagnostic[];
}) {
  if (diagnostics.length === 0) return null;
  return (
    <details className="mx-3 my-2 rounded border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-ink-muted">
      <summary className="cursor-pointer font-medium">
        {diagnostics.length} plan {diagnostics.length === 1 ? "warning" : "warnings"}
      </summary>
      <ul className="mt-2 list-disc pl-5">
        {diagnostics.map((diagnostic) => (
          <li key={`${diagnostic.resourceKey}:${diagnostic.capability}`}>
            <code>{diagnostic.resourceKey}</code>: {CAPABILITY_MESSAGES[diagnostic.capability]}
          </li>
        ))}
      </ul>
    </details>
  );
}
