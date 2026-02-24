import { useEffect, useState } from "react";
import { useJobNavigation } from "../../hooks/use-job-navigation.ts";
import { ValueFormatContext } from "../../hooks/use-value-format.ts";
import type { DagNodeData } from "../../types/graph-types.ts";
import type { PhantomContext } from "../../types/phantom-context.ts";
import type { ChangeDesc } from "../../types/plan-schema.ts";
import type { ValueFormat } from "../../utils/format-value.ts";
import { DiffStateBadge } from "./diff-state-badge.tsx";
import { FormatToggle, NEXT_FORMAT } from "./format-toggle.tsx";
import { ModifiedBody } from "./modified-body.tsx";
import { ObjectStateCard } from "./object-state-card.tsx";
import { RawJsonDisclosure } from "./raw-json-disclosure.tsx";
import { ResourceStateView } from "./resource-state-view.tsx";
import { TaskChangesSummary } from "./task-changes-summary.tsx";

type DetailPanelProps = {
  readonly data: DagNodeData;
  readonly onClose: () => void;
  readonly width: number;
  readonly phantomContext?: PhantomContext;
};

const NOISE_ACTIONS: ReadonlySet<string> = new Set(["skip", ""]);

function filterMeaningfulChanges(
  changes: Readonly<Record<string, ChangeDesc>> | undefined,
): readonly (readonly [string, ChangeDesc])[] {
  if (changes === undefined) return [];
  return Object.entries(changes).filter(([, change]) => !NOISE_ACTIONS.has(change.action));
}

function ViewInJobsTabButton({ resourceKey }: { readonly resourceKey: string }) {
  const navigateToJob = useJobNavigation();
  if (navigateToJob === null) return null;
  return (
    <button
      type="button"
      onClick={() => navigateToJob(resourceKey)}
      className="mb-3 flex w-full items-center justify-center gap-1.5 rounded border border-accent/30 bg-accent/5 px-3 py-1.5 text-xs font-medium text-accent transition-colors hover:bg-accent/10"
    >
      View in Jobs tab
      <span aria-hidden="true">&rarr;</span>
    </button>
  );
}

export function DetailPanel({ data, onClose, width, phantomContext }: DetailPanelProps) {
  const [valueFormat, setValueFormat] = useState<ValueFormat>("yaml");
  const meaningfulChanges = filterMeaningfulChanges(data.changes);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const toggleFormat = () => setValueFormat((current) => NEXT_FORMAT[current]);

  const hasTaskSummary =
    (data.nodeKind === "job" || data.nodeKind === "resource") &&
    data.taskChangeSummary !== undefined;

  const showNoChanges =
    data.diffState === "modified" &&
    meaningfulChanges.length === 0 &&
    data.resourceState === undefined &&
    !hasTaskSummary;

  return (
    <ValueFormatContext.Provider value={valueFormat}>
      <div
        className="flex h-full shrink-0 flex-col border-l border-outline bg-surface-raised"
        style={{ width }}
      >
        <div className="flex items-center justify-between border-b border-outline-subtle px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="min-w-0 break-words text-sm font-semibold text-ink">{data.label}</h2>
            <DiffStateBadge diffState={data.diffState} />
          </div>
          <div className="ml-2 flex shrink-0 items-center gap-1.5">
            <FormatToggle format={valueFormat} onToggle={toggleFormat} />
            <button
              type="button"
              onClick={onClose}
              className="rounded p-1 text-ink-muted hover:bg-surface-hover hover:text-ink-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 20 20"
                fill="currentColor"
                className="h-4 w-4"
              >
                <title>Close panel</title>
                <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
              </svg>
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 pb-4">
          {data.nodeKind === "phantom" && (
            <div className="mb-3 rounded border border-dashed border-outline/60 bg-surface-inset/40 px-3 py-2 text-xs text-ink-muted">
              <p>Untracked by this bundle</p>
              {phantomContext !== undefined && phantomContext.sources.length > 0 && (
                <div className="mt-2">
                  <p className="font-medium text-ink-secondary">
                    {phantomContext.kind === "sync-target" ? "Sync target of:" : "Inferred from:"}
                  </p>
                  <ul className="mt-1 space-y-0.5">
                    {phantomContext.sources.map(({ label, resourceKey, resourceType }) => (
                      <li
                        key={resourceKey}
                        className="truncate pl-2 font-mono text-[11px]"
                        title={resourceKey}
                      >
                        {label}
                        {resourceType !== undefined && (
                          <span className="ml-1.5 font-sans text-ink-muted/60">
                            ({resourceType})
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Inline narrowing: TypeScript can't track hasTaskSummary back to the discriminated union. */}
          {(data.nodeKind === "job" || data.nodeKind === "resource") &&
            data.taskChangeSummary !== undefined && (
              <TaskChangesSummary summary={data.taskChangeSummary} />
            )}

          {data.nodeKind === "resource" && data.taskChangeSummary !== undefined && (
            <ViewInJobsTabButton resourceKey={data.resourceKey} />
          )}

          {(data.diffState === "added" || data.diffState === "removed") && (
            <ObjectStateCard
              label={data.label}
              nodeKind={data.nodeKind}
              resourceState={data.resourceState ?? {}}
              variant={data.diffState}
            />
          )}

          {data.diffState === "modified" && (
            <ModifiedBody data={data} meaningfulChanges={meaningfulChanges} />
          )}

          {data.diffState === "unchanged" && (
            <ResourceStateView resourceState={data.resourceState ?? {}} />
          )}

          {showNoChanges && <p className="py-8 text-center text-sm text-ink-muted">No changes</p>}

          <RawJsonDisclosure data={data} />
        </div>
      </div>
    </ValueFormatContext.Provider>
  );
}
