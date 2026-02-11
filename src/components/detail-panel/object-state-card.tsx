import type { NodeKind } from "../../types/graph-types.ts";
import { DiffStateBadge } from "./diff-state-badge.tsx";
import { StateFieldRow } from "./state-field-row.tsx";

const OBJECT_CARD_STYLES: Readonly<Record<"added" | "removed", { readonly border: string }>> = {
  added: { border: "border-diff-added/60" },
  removed: { border: "border-diff-removed/60" },
};

const OBJECT_CARD_SUBTITLE: Readonly<Record<"added" | "removed", string>> = {
  added: "was created",
  removed: "was deleted",
};

export function ObjectStateCard({
  label,
  nodeKind,
  resourceState,
  variant,
}: {
  readonly label: string;
  readonly nodeKind: NodeKind;
  readonly resourceState: Readonly<Record<string, unknown>>;
  readonly variant: "added" | "removed";
}) {
  const style = OBJECT_CARD_STYLES[variant];
  const sortedKeys = Object.keys(resourceState).toSorted();

  return (
    <div className={`rounded-lg border ${style.border} bg-surface-raised/50`}>
      <div className="flex items-center justify-between gap-2 px-3 pt-3 pb-1">
        <span className="font-mono text-sm text-ink">{label}</span>
        <DiffStateBadge diffState={variant} />
      </div>
      <p className="px-3 pb-2 text-xs italic text-ink-muted">
        This {nodeKind} {OBJECT_CARD_SUBTITLE[variant]}
      </p>
      <div className="flex flex-col gap-1.5 border-t border-outline-subtle p-3">
        {sortedKeys.map((key) => (
          <StateFieldRow key={key} fieldKey={key} value={resourceState[key]} variant={variant} />
        ))}
      </div>
    </div>
  );
}
