import type { DagNodeData } from "../../types/graph-types.ts";
import { getDiffStateStyles } from "../../utils/diff-state-styles.ts";

export function DiffStateBadge({ diffState }: { readonly diffState: DagNodeData["diffState"] }) {
  const styles = getDiffStateStyles(diffState);
  return (
    <span
      className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${styles.background} ${styles.text}`}
    >
      {diffState}
    </span>
  );
}
