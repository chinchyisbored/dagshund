import type { ChangeDesc } from "../../types/plan-schema.ts";
import { computeStructuralDiff } from "../../utils/structural-diff.ts";
import { stripTaskPrefix } from "../../utils/task-key.ts";
import { StructuralDiffView } from "../structural-diff-view.tsx";
import { ActionBadge } from "./action-badge.tsx";

export function ChangeEntry({
  fieldPath,
  change,
}: {
  readonly fieldPath: string;
  readonly change: ChangeDesc;
}) {
  const diffResult = computeStructuralDiff(change);

  return (
    <div className="rounded border border-outline-subtle bg-surface-raised/50 p-3">
      <div className="mb-2 flex items-start gap-2">
        <span className="min-w-0 flex-1 break-words font-mono text-xs text-ink-secondary">
          {stripTaskPrefix(fieldPath)}
        </span>
        <span className="shrink-0">
          <ActionBadge action={change.action} />
        </span>
      </div>
      <StructuralDiffView result={diffResult} />
    </div>
  );
}
