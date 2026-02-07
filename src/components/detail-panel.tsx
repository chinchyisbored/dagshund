import type { DagNodeData } from "../types/graph-types.ts";
import type { ChangeDesc } from "../types/plan-schema.ts";
import { formatValue } from "../utils/format-value.ts";
import { computeStructuralDiff } from "../utils/structural-diff.ts";
import { getDiffStateStyles } from "./diff-state-styles.ts";
import { StructuralDiffView } from "./structural-diff-view.tsx";

type DetailPanelProps = {
  readonly data: DagNodeData;
  readonly onClose: () => void;
};

const NOISE_ACTIONS: ReadonlySet<string> = new Set(["skip", ""]);

const TASK_KEY_PREFIX_PATTERN = /^tasks\[task_key='[^']*'\]\./;

/** Strip the `tasks[task_key='...'].` prefix from a change key for display. */
const stripTaskPrefix = (key: string): string => key.replace(TASK_KEY_PREFIX_PATTERN, "");

const ACTION_BADGE_COLORS: Readonly<Record<string, string>> = {
  create: "text-emerald-400 bg-emerald-400/10",
  update: "text-amber-400 bg-amber-400/10",
  update_id: "text-amber-400 bg-amber-400/10",
  delete: "text-red-400 bg-red-400/10",
  recreate: "text-orange-400 bg-orange-400/10",
  resize: "text-blue-400 bg-blue-400/10",
};

function ActionBadge({ action }: { readonly action: string }) {
  const colors = ACTION_BADGE_COLORS[action] ?? "text-zinc-400 bg-zinc-400/10";
  return <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${colors}`}>{action}</span>;
}

function DiffStateBadge({ diffState }: { readonly diffState: DagNodeData["diffState"] }) {
  const styles = getDiffStateStyles(diffState);
  return (
    <span
      className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${styles.background} ${styles.text}`}
    >
      {diffState}
    </span>
  );
}

function ChangeEntry({
  fieldPath,
  change,
}: {
  readonly fieldPath: string;
  readonly change: ChangeDesc;
}) {
  const diffResult = computeStructuralDiff(change);

  return (
    <div className="rounded border border-zinc-700/50 bg-zinc-800/50 p-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="font-mono text-xs text-zinc-300">{stripTaskPrefix(fieldPath)}</span>
        <ActionBadge action={change.action} />
      </div>
      <StructuralDiffView result={diffResult} />
    </div>
  );
}

function ResourceStateView({
  resourceState,
}: {
  readonly resourceState: Readonly<Record<string, unknown>>;
}) {
  const sortedKeys = Object.keys(resourceState).toSorted();

  return (
    <div className="flex flex-col gap-1.5">
      {sortedKeys.map((key) => (
        <div key={key} className="rounded border border-zinc-800 bg-zinc-800/30 px-3 py-2">
          <span className="font-mono text-xs text-zinc-400">{key}</span>
          <pre className="mt-1 whitespace-pre-wrap break-all font-mono text-xs text-zinc-500">
            {formatValue(resourceState[key])}
          </pre>
        </div>
      ))}
    </div>
  );
}

/** Extract the top-level field name from a change path (e.g. `notebook_task.notebook_path` → `notebook_task`). */
const topLevelFieldName = (path: string): string => {
  const stripped = stripTaskPrefix(path);
  const dotIndex = stripped.indexOf(".");
  return dotIndex === -1 ? stripped : stripped.slice(0, dotIndex);
};

/** Collect the set of top-level field names that appear in meaningful changes. */
const collectChangedFieldNames = (
  changes: readonly (readonly [string, ChangeDesc])[],
): ReadonlySet<string> => new Set(changes.map(([path]) => topLevelFieldName(path)));

/** Filter resourceState to exclude keys whose top-level name appears in changes. */
const filterUnmodifiedState = (
  resourceState: Readonly<Record<string, unknown>>,
  changedFields: ReadonlySet<string>,
): Readonly<Record<string, unknown>> =>
  Object.fromEntries(Object.entries(resourceState).filter(([key]) => !changedFields.has(key)));

/** Diff states where the create/delete diff already shows full state — no config section needed. */
const SHOWS_FULL_STATE: ReadonlySet<DagNodeData["diffState"]> = new Set(["added", "removed"]);

function filterMeaningfulChanges(
  changes: Readonly<Record<string, ChangeDesc>> | undefined,
): readonly (readonly [string, ChangeDesc])[] {
  if (changes === undefined) return [];
  return Object.entries(changes).filter(([, change]) => !NOISE_ACTIONS.has(change.action));
}

export function DetailPanel({ data, onClose }: DetailPanelProps) {
  const meaningfulChanges = filterMeaningfulChanges(data.changes);
  const showConfig = data.resourceState !== undefined && !SHOWS_FULL_STATE.has(data.diffState);
  const changedFields = collectChangedFieldNames(meaningfulChanges);
  // biome-ignore lint/style/noNonNullAssertion: guarded by showConfig check above
  const unmodifiedState = showConfig
    ? filterUnmodifiedState(data.resourceState!, changedFields)
    : {};
  const hasUnmodifiedState = showConfig && Object.keys(unmodifiedState).length > 0;

  return (
    <div className="flex h-full w-[380px] shrink-0 flex-col border-l border-zinc-700 bg-zinc-900">
      <div className="flex items-center justify-between border-b border-zinc-700/50 px-4 py-3">
        <h2 className="truncate text-sm font-semibold text-zinc-100">{data.label}</h2>
        <button
          type="button"
          onClick={onClose}
          className="ml-2 rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
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

      <div className="px-4 py-2">
        <DiffStateBadge diffState={data.diffState} />
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {meaningfulChanges.length > 0 && (
          <div className="flex flex-col gap-2">
            {meaningfulChanges.map(([fieldPath, change]) => (
              <ChangeEntry key={fieldPath} fieldPath={fieldPath} change={change} />
            ))}
          </div>
        )}

        {hasUnmodifiedState && (
          <>
            {meaningfulChanges.length > 0 && (
              <div className="my-4 flex items-center gap-2">
                <div className="h-px flex-1 bg-zinc-700/50" />
                <span className="whitespace-nowrap text-xs text-zinc-500">
                  Unmodified Configuration
                </span>
                <div className="h-px flex-1 bg-zinc-700/50" />
              </div>
            )}
            <ResourceStateView resourceState={unmodifiedState} />
          </>
        )}

        {meaningfulChanges.length === 0 && !hasUnmodifiedState && (
          <p className="py-8 text-center text-sm text-zinc-500">No changes</p>
        )}
      </div>
    </div>
  );
}
