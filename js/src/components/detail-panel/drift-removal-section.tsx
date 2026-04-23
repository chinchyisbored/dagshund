import type { ChangeDesc } from "../../types/plan-schema.ts";
import { DriftCard } from "./drift-card.tsx";
import { SectionDivider } from "./section-divider.tsx";

/**
 * "Removed on apply (drift)" panel: lists list elements present on the remote
 * but missing from the bundle, reclassified as drift because the enclosing
 * resource has shape drift (see `isReclassifiedListElementDriftChange`). They
 * will be removed on the next apply.
 */
export function DriftRemovalSection({
  driftRemovalChanges,
}: {
  readonly driftRemovalChanges: Readonly<Record<string, ChangeDesc>>;
}) {
  const entries = Object.entries(driftRemovalChanges);

  return (
    <div className="mb-3">
      <SectionDivider label="Removed on apply (drift)" />
      <p className="mb-2 text-xs text-ink-muted">
        Present on the remote but missing from your bundle — apply will remove it.
      </p>
      <div className="flex flex-col gap-1.5">
        {entries.map(([fieldPath, change]) => (
          <DriftCard
            key={fieldPath}
            fieldPath={fieldPath}
            value={change.remote}
            variant="removal"
          />
        ))}
      </div>
    </div>
  );
}
