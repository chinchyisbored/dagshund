import type { ChangeDesc } from "../../types/plan-schema.ts";
import { deriveFieldAction, type FieldChangeContext } from "../../utils/field-action.ts";
import { computeStructuralDiff } from "../../utils/structural-diff.ts";
import { stripTaskPrefix } from "../../utils/task-key.ts";
import { StructuralDiffView } from "../structural-diff-view.tsx";
import { ActionBadge } from "./action-badge.tsx";
import { DriftPill } from "./drift-pill.tsx";

export function ChangeEntry({
  fieldPath,
  change,
  ctx,
}: {
  readonly fieldPath: string;
  readonly change: ChangeDesc;
  readonly ctx: FieldChangeContext;
}) {
  const diffResult = computeStructuralDiff(change, ctx);
  const fieldAction = deriveFieldAction(change, ctx);
  // Drift treatment at every level: graph nodes, topology re-entry section,
  // and field-level drift cards. Dashed border in the `modified` palette
  // (not the subtle outline which is invisible), plus the drift pill next
  // to the action badge so the header row scans like the node header.
  const isDrift = diffResult.kind === "diff" && diffResult.semantic === "drift";
  const borderClasses = isDrift ? "border-dashed border-diff-modified" : "border-outline-subtle";

  return (
    <div className={`rounded border ${borderClasses} bg-surface-raised/50 p-3`}>
      <div className="mb-2 flex items-start gap-2">
        <span className="min-w-0 flex-1 break-words font-mono text-xs text-ink-secondary">
          {stripTaskPrefix(fieldPath)}
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          {isDrift && <DriftPill />}
          <ActionBadge action={fieldAction} />
        </span>
      </div>
      <StructuralDiffView result={diffResult} />
    </div>
  );
}
