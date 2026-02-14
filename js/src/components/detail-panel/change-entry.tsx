import type { ChangeDesc } from "../../types/plan-schema.ts";
import { computeStructuralDiff } from "../../utils/structural-diff.ts";
import { TASK_KEY_DOT_PREFIX_PATTERN } from "../../utils/task-key.ts";
import { StructuralDiffView } from "../structural-diff-view.tsx";
import { ActionBadge } from "./action-badge.tsx";

/** Strip the `tasks[task_key='...'].` prefix from a change key for display. */
export const stripTaskPrefix = (key: string): string =>
  key.replace(TASK_KEY_DOT_PREFIX_PATTERN, "");

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
      <div className="mb-2 flex items-center gap-2">
        <span className="font-mono text-xs text-ink-secondary">{stripTaskPrefix(fieldPath)}</span>
        <ActionBadge action={change.action} />
      </div>
      <StructuralDiffView result={diffResult} />
    </div>
  );
}
