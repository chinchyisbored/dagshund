import { useValueFormat } from "../../hooks/use-value-format.ts";
import type { ChangeDesc } from "../../types/plan-schema.ts";
import { formatValue } from "../../utils/format-value.ts";
import { stripTaskPrefix } from "../../utils/task-key.ts";
import { PrefixedBlock } from "../structural-diff-view.tsx";
import { SectionDivider } from "./section-divider.tsx";

/**
 * "Re-added on apply" panel: lists sub-entities present in the bundle but
 * missing from the remote. Databricks encodes these as changes where old ==
 * new with no `remote` field (see `isTopologyDriftChange`); they will be
 * recreated on the next apply.
 */
export function DriftReentrySection({
  driftChanges,
}: {
  readonly driftChanges: Readonly<Record<string, ChangeDesc>>;
}) {
  const format = useValueFormat();
  const entries = Object.entries(driftChanges);

  return (
    <div className="mb-3">
      <SectionDivider label="Re-added on apply" />
      <p className="mb-2 text-xs text-ink-muted">
        Present in your bundle but missing from the remote — will be recreated on apply.
      </p>
      <div className="flex flex-col gap-1.5">
        {entries.map(([fieldPath, change]) => {
          const formatted = formatValue(change.new, format);
          return (
            <div
              key={fieldPath}
              // Dashed green outline, no fill — matches the card convention
              // (ObjectStateCard, ChangeEntry). Dashed signals "drift re-entry",
              // green signals "will be added on apply". `+ ` prefix on key and
              // value lines mirrors StateFieldRow so drift entries scan the
              // same way as a normal added-state field.
              className="rounded border border-dashed border-diff-added bg-surface-raised/50 px-3 py-2"
            >
              <PrefixedBlock
                prefix="+ "
                text={stripTaskPrefix(fieldPath)}
                className="text-diff-added"
              />
              <PrefixedBlock prefix="+   " text={formatted} className="text-diff-added" />
            </div>
          );
        })}
      </div>
    </div>
  );
}
