import { useEffect, useMemo, useState } from "react";
import { useJobNavigation } from "../../hooks/contexts.ts";
import { ValueFormatContext } from "../../hooks/use-value-format.ts";
import type { DagNodeData } from "../../types/graph-types.ts";
import type { LateralContext } from "../../types/lateral-context.ts";
import type { PhantomContext } from "../../types/phantom-context.ts";
import { expandEmbedEntries } from "../../utils/embed-entries.ts";
import type { ValueFormat } from "../../utils/format-value.ts";
import { DiffStateBadge } from "./diff-state-badge.tsx";
import { DriftPill } from "./drift-pill.tsx";
import { DriftReentrySection } from "./drift-reentry-section.tsx";
import { DriftRemovalSection } from "./drift-removal-section.tsx";
import { splitMeaningfulChanges } from "./filter-changes.ts";
import { FormatToggle, NEXT_FORMAT } from "./format-toggle.tsx";
import { LateralDependencies } from "./lateral-dependencies.tsx";
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
  readonly lateralContext?: LateralContext;
  readonly onNavigateToNode?: (nodeId: string) => void;
};

/** Nodes that can carry the orthogonal `isDrift` dimension. */
const nodeCanDrift = (data: DagNodeData): boolean =>
  (data.nodeKind === "task" || data.nodeKind === "job" || data.nodeKind === "resource") &&
  data.isDrift === true;

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

export function DetailPanel({
  data,
  onClose,
  width,
  phantomContext,
  lateralContext,
  onNavigateToNode,
}: DetailPanelProps) {
  const [valueFormat, setValueFormat] = useState<ValueFormat>("yaml");
  const { driftReentryChanges, driftRemovalChanges, fieldChanges, allChangePaths } =
    splitMeaningfulChanges(data.changes, {
      newState: data.newState,
      remoteState: data.remoteState,
      resourceHasShapeDrift: data.resourceHasShapeDrift,
    });
  const hasDriftReentries = Object.keys(driftReentryChanges).length > 0;
  const hasDriftRemovals = Object.keys(driftRemovalChanges).length > 0;
  const isDriftNode = nodeCanDrift(data);
  const expandedState = useMemo(
    () => expandEmbedEntries(data.resourceState ?? {}),
    [data.resourceState],
  );

  useEffect(() => {
    const closePanelOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", closePanelOnEscape);
    return () => document.removeEventListener("keydown", closePanelOnEscape);
  }, [onClose]);

  const toggleFormat = () => setValueFormat((current) => NEXT_FORMAT[current]);

  const hasTaskSummary =
    (data.nodeKind === "job" || data.nodeKind === "resource") &&
    data.taskChangeSummary !== undefined;

  const showNoChanges =
    data.diffState === "modified" &&
    fieldChanges.length === 0 &&
    !hasDriftReentries &&
    !hasDriftRemovals &&
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
            {isDriftNode && <DriftPill />}
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
                  <p className="font-medium text-ink-secondary">Inferred from:</p>
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

          {/* Drift sections are hoisted above the diffState body switch so they
             render for any body path (added/modified/unchanged) — a node can
             be `isDrift: true` while its own diffState is any value. Re-entry
             is suppressed when the node itself is a drift re-add
             (`isDrift` + `added`): the green ObjectStateCard already shows the
             exact same definition, so a separate section would duplicate
             content. */}
          {hasDriftReentries && !(isDriftNode && data.diffState === "added") && (
            <DriftReentrySection driftReentryChanges={driftReentryChanges} />
          )}
          {hasDriftRemovals && <DriftRemovalSection driftRemovalChanges={driftRemovalChanges} />}

          {(data.diffState === "added" || data.diffState === "removed") && (
            <ObjectStateCard
              label={data.label}
              nodeKind={data.nodeKind}
              resourceState={expandedState}
              variant={data.diffState}
              isDriftReentry={isDriftNode && data.diffState === "added"}
            />
          )}

          {data.diffState === "modified" && (
            <ModifiedBody
              data={data}
              fieldChanges={fieldChanges}
              // Pass every partitioned path so drift sections (rendered above)
              // and the Unchanged section don't double-render the same list
              // element (dagshund-93lv / dagshund-3hdx).
              excludePaths={allChangePaths}
            />
          )}

          {(data.diffState === "unchanged" || data.diffState === "unknown") && (
            <ResourceStateView resourceState={expandedState} />
          )}

          {showNoChanges && <p className="py-8 text-center text-sm text-ink-muted">No changes</p>}

          {lateralContext !== undefined && onNavigateToNode !== undefined && (
            <LateralDependencies context={lateralContext} onNavigateToNode={onNavigateToNode} />
          )}

          <RawJsonDisclosure data={data} />
        </div>
      </div>
    </ValueFormatContext.Provider>
  );
}
