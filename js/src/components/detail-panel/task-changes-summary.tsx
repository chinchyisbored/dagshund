import { memo } from "react";
import type { DagNodeData, TaskChangeSummary } from "../../types/graph-types.ts";
import { getDiffBadge, getDiffStateStyles } from "../../utils/diff-state-styles.ts";
import { DiffStateBadge } from "./diff-state-badge.tsx";
import { DriftPill } from "./drift-pill.tsx";
import { SectionDivider } from "./section-divider.tsx";

const TaskChangeLine = memo(function TaskChangeLine({
  taskKey,
  diffState,
  isDrift,
}: {
  readonly taskKey: string;
  readonly diffState: DagNodeData["diffState"];
  readonly isDrift: boolean;
}) {
  const styles = getDiffStateStyles(diffState);
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className={`font-mono text-xs ${styles.text}`}>
        {diffState === "unchanged" ? " " : getDiffBadge(diffState)} {taskKey}
      </span>
      <span className="flex items-center gap-1.5">
        {isDrift && <DriftPill />}
        <DiffStateBadge diffState={diffState} />
      </span>
    </div>
  );
});

export function TaskChangesSummary({ summary }: { readonly summary: TaskChangeSummary }) {
  return (
    <div className="mb-3">
      <SectionDivider label="Task Changes" />
      <div className="flex flex-col gap-0.5">
        {summary.map((entry) => (
          <TaskChangeLine
            key={entry.taskKey}
            taskKey={entry.taskKey}
            diffState={entry.diffState}
            isDrift={entry.isDrift}
          />
        ))}
      </div>
    </div>
  );
}
