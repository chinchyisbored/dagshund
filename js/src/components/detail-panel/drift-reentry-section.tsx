import type { ChangeDesc } from "../../types/plan-schema.ts";
import { DriftCard } from "./drift-card.tsx";
import { SectionDivider } from "./section-divider.tsx";

/**
 * "Re-added on apply (drift)" panel: lists sub-entities present in the bundle
 * but missing from the remote. Databricks encodes these as changes where old ==
 * new with no `remote` field (see `isTopologyDriftChange`); they will be
 * recreated on the next apply.
 */
export function DriftReentrySection({
  driftReentryChanges,
}: {
  readonly driftReentryChanges: Readonly<Record<string, ChangeDesc>>;
}) {
  const entries = Object.entries(driftReentryChanges);

  return (
    <div className="mb-3">
      <SectionDivider label="Re-added on apply (drift)" />
      <p className="mb-2 text-xs text-ink-muted">
        Present in your bundle but missing from the remote — apply will re-add it.
      </p>
      <div className="flex flex-col gap-1.5">
        {entries.map(([fieldPath, change]) => (
          <DriftCard key={fieldPath} fieldPath={fieldPath} value={change.new} variant="reentry" />
        ))}
      </div>
    </div>
  );
}
