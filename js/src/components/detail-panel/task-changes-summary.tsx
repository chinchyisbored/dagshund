import type { DagNodeData, TaskChangeSummary } from "../../types/graph-types.ts";
import { getDiffBadge, getDiffStateStyles } from "../diff-state-styles.ts";
import { DiffStateBadge } from "./diff-state-badge.tsx";
import { SectionDivider } from "./section-divider.tsx";

function TaskChangeLine({
  taskKey,
  diffState,
}: {
  readonly taskKey: string;
  readonly diffState: DagNodeData["diffState"];
}) {
  const styles = getDiffStateStyles(diffState);
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className={`font-mono text-xs ${styles.text}`}>
        {diffState === "unchanged" ? " " : getDiffBadge(diffState)} {taskKey}
      </span>
      <DiffStateBadge diffState={diffState} />
    </div>
  );
}

export function TaskChangesSummary({ summary }: { readonly summary: TaskChangeSummary }) {
  return (
    <div className="mb-3">
      <SectionDivider label="Task Changes" />
      <div className="flex flex-col gap-0.5">
        {summary.map((entry) => (
          <TaskChangeLine key={entry.taskKey} taskKey={entry.taskKey} diffState={entry.diffState} />
        ))}
      </div>
    </div>
  );
}
