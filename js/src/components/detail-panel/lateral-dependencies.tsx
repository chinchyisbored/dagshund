import { memo } from "react";
import type { LateralContext, LateralDependencyEntry } from "../../types/lateral-context.ts";
import { DiffStateBadge } from "./diff-state-badge.tsx";
import { SectionDivider } from "./section-divider.tsx";

const DependencyEntry = memo(function DependencyEntry({
  entry,
  onNavigate,
}: {
  readonly entry: LateralDependencyEntry;
  readonly onNavigate: (nodeId: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onNavigate(entry.nodeId)}
      className="flex w-full items-center justify-between rounded px-2 py-1 text-left transition-colors hover:bg-surface-hover"
      title={entry.resourceKey}
    >
      <span className="min-w-0 truncate font-mono text-xs text-ink-secondary">
        {entry.label}
        {entry.resourceType !== undefined && (
          <span className="ml-1.5 font-sans text-ink-muted/60">({entry.resourceType})</span>
        )}
      </span>
      <span className="ml-2 shrink-0">
        <DiffStateBadge diffState={entry.diffState} />
      </span>
    </button>
  );
});

const DependencyList = memo(function DependencyList({
  label,
  entries,
  onNavigate,
}: {
  readonly label: string;
  readonly entries: readonly LateralDependencyEntry[];
  readonly onNavigate: (nodeId: string) => void;
}) {
  if (entries.length === 0) return null;
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-ink-secondary">{label}</p>
      <div className="flex flex-col gap-0.5">
        {entries.map((entry) => (
          <DependencyEntry key={entry.nodeId} entry={entry} onNavigate={onNavigate} />
        ))}
      </div>
    </div>
  );
});

export function LateralDependencies({
  context,
  onNavigateToNode,
}: {
  readonly context: LateralContext;
  readonly onNavigateToNode: (nodeId: string) => void;
}) {
  return (
    <div className="mb-3">
      <SectionDivider label="Dependencies" />
      <div className="flex flex-col gap-3">
        <DependencyList
          label="Depends on"
          entries={context.dependsOn}
          onNavigate={onNavigateToNode}
        />
        <DependencyList
          label="Depended on by"
          entries={context.dependedOnBy}
          onNavigate={onNavigateToNode}
        />
      </div>
    </div>
  );
}
