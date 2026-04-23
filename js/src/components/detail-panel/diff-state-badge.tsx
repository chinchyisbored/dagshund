import type { DagNodeData } from "../../types/graph-types.ts";
import { getDiffStateStyles } from "../../utils/diff-state-styles.ts";

const DIFF_STATE_TOOLTIPS: Readonly<Record<DagNodeData["diffState"], string>> = {
  added: "Will be created on apply",
  modified: "Has field-level changes",
  removed: "Will be removed on apply",
  unchanged: "No changes planned",
  unknown: "State could not be determined",
};

export function DiffStateBadge({ diffState }: { readonly diffState: DagNodeData["diffState"] }) {
  const styles = getDiffStateStyles(diffState);
  return (
    <span
      className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${styles.background} ${styles.text}`}
      title={DIFF_STATE_TOOLTIPS[diffState]}
    >
      {diffState}
    </span>
  );
}
