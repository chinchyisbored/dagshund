import { useState } from "react";
import type { DagNodeData, NodeKind, TaskChangeSummary } from "../types/graph-types.ts";
import type { ChangeDesc } from "../types/plan-schema.ts";
import { ValueFormatContext, useValueFormat } from "../hooks/use-value-format.ts";
import type { ValueFormat } from "../utils/format-value.ts";
import { formatValue } from "../utils/format-value.ts";
import { computeStructuralDiff } from "../utils/structural-diff.ts";
import { getDiffStateStyles } from "./diff-state-styles.ts";
import { PrefixedBlock, StructuralDiffView } from "./structural-diff-view.tsx";

type DetailPanelProps = {
  readonly data: DagNodeData;
  readonly onClose: () => void;
};

const NOISE_ACTIONS: ReadonlySet<string> = new Set(["skip", ""]);

import { TASK_KEY_DOT_PREFIX_PATTERN } from "../utils/task-key.ts";

/** Strip the `tasks[task_key='...'].` prefix from a change key for display. */
const stripTaskPrefix = (key: string): string => key.replace(TASK_KEY_DOT_PREFIX_PATTERN, "");

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

/** CSS hanging indent: first visual line at col 0, wrapped continuations at 4ch. */
const VALUE_HANGING_INDENT = { paddingLeft: "4ch", textIndent: "-4ch" } as const;

function ResourceStateView({
  resourceState,
}: {
  readonly resourceState: Readonly<Record<string, unknown>>;
}) {
  const format = useValueFormat();
  const sortedKeys = Object.keys(resourceState).toSorted();

  return (
    <div className="flex flex-col gap-1.5">
      {sortedKeys.map((key) => {
        const formatted = formatValue(resourceState[key], format);
        return (
          <div key={key} className="rounded border border-zinc-800 bg-zinc-800/30 px-3 py-2">
            <span className="font-mono text-xs text-zinc-400">{key}</span>
            <div className="mt-1">
              {formatted.split("\n").map((line, i) => (
                <div
                  key={i}
                  className="whitespace-pre-wrap break-words font-mono text-xs text-zinc-500"
                  style={VALUE_HANGING_INDENT}
                >
                  {line}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SectionDivider({ label }: { readonly label: string }) {
  return (
    <div className="my-4 flex items-center gap-2">
      <div className="h-px flex-1 bg-zinc-700/50" />
      <span className="whitespace-nowrap text-xs text-zinc-500">{label}</span>
      <div className="h-px flex-1 bg-zinc-700/50" />
    </div>
  );
}

const STATE_FIELD_STYLES: Readonly<
  Record<"added" | "removed", { readonly prefix: string; readonly text: string }>
> = {
  added: { prefix: "+", text: "text-emerald-300" },
  removed: { prefix: "-", text: "text-red-400" },
};

function StateFieldRow({
  fieldKey,
  value,
  variant,
}: {
  readonly fieldKey: string;
  readonly value: unknown;
  readonly variant: "added" | "removed";
}) {
  const format = useValueFormat();
  const style = STATE_FIELD_STYLES[variant];
  const formatted = formatValue(value, format);
  return (
    <div className="rounded border border-zinc-700/40 bg-zinc-800/30 px-3 py-2">
      <PrefixedBlock prefix={`${style.prefix} `} text={fieldKey} className={style.text} />
      <PrefixedBlock
        prefix={`${style.prefix}   `}
        text={formatted}
        className={`${style.text} opacity-80`}
      />
    </div>
  );
}

const OBJECT_CARD_STYLES: Readonly<Record<"added" | "removed", { readonly border: string }>> = {
  added: { border: "border-emerald-500/60" },
  removed: { border: "border-red-500/60" },
};

const OBJECT_CARD_SUBTITLE: Readonly<Record<"added" | "removed", string>> = {
  added: "was created",
  removed: "was deleted",
};

function ObjectStateCard({
  label,
  nodeKind,
  resourceState,
  variant,
}: {
  readonly label: string;
  readonly nodeKind: NodeKind;
  readonly resourceState: Readonly<Record<string, unknown>>;
  readonly variant: "added" | "removed";
}) {
  const style = OBJECT_CARD_STYLES[variant];
  const sortedKeys = Object.keys(resourceState).toSorted();

  return (
    <div className={`rounded-lg border ${style.border} bg-zinc-800/50`}>
      <div className="flex items-center justify-between gap-2 px-3 pt-3 pb-1">
        <span className="font-mono text-sm text-zinc-200">{label}</span>
        <DiffStateBadge diffState={variant} />
      </div>
      <p className="px-3 pb-2 text-xs italic text-zinc-500">
        This {nodeKind} {OBJECT_CARD_SUBTITLE[variant]}
      </p>
      <div className="flex flex-col gap-1.5 border-t border-zinc-700/40 p-3">
        {sortedKeys.map((key) => (
          <StateFieldRow key={key} fieldKey={key} value={resourceState[key]} variant={variant} />
        ))}
      </div>
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

function filterMeaningfulChanges(
  changes: Readonly<Record<string, ChangeDesc>> | undefined,
): readonly (readonly [string, ChangeDesc])[] {
  if (changes === undefined) return [];
  return Object.entries(changes).filter(([, change]) => !NOISE_ACTIONS.has(change.action));
}

const DIFF_STATE_PREFIX: Readonly<Record<string, string>> = {
  added: "+",
  removed: "-",
  modified: "~",
};

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
        {DIFF_STATE_PREFIX[diffState] ?? " "} {taskKey}
      </span>
      <DiffStateBadge diffState={diffState} />
    </div>
  );
}

function TaskChangesSummary({ summary }: { readonly summary: TaskChangeSummary }) {
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

const ADDED_ACTIONS: ReadonlySet<string> = new Set(["create"]);
const REMOVED_ACTIONS: ReadonlySet<string> = new Set(["delete"]);

type ChangeGroup = {
  readonly label: string;
  readonly entries: readonly (readonly [string, ChangeDesc])[];
};

/** Group meaningful changes into Added / Modified / Removed sections. */
const groupChangesByCategory = (
  changes: readonly (readonly [string, ChangeDesc])[],
): readonly ChangeGroup[] => {
  const added: (readonly [string, ChangeDesc])[] = [];
  const modified: (readonly [string, ChangeDesc])[] = [];
  const removed: (readonly [string, ChangeDesc])[] = [];

  for (const entry of changes) {
    const action = entry[1].action;
    if (ADDED_ACTIONS.has(action)) {
      added.push(entry);
    } else if (REMOVED_ACTIONS.has(action)) {
      removed.push(entry);
    } else {
      modified.push(entry);
    }
  }

  return [
    { label: "Added", entries: added },
    { label: "Modified", entries: modified },
    { label: "Removed", entries: removed },
  ].filter((group) => group.entries.length > 0);
};

function AddedOrRemovedBody({ data }: { readonly data: DagNodeData }) {
  const variant = data.diffState === "added" ? "added" : "removed";
  const resourceState = data.resourceState ?? {};

  return (
    <ObjectStateCard
      label={data.label}
      nodeKind={data.nodeKind}
      resourceState={resourceState}
      variant={variant}
    />
  );
}

function ModifiedBody({
  data,
  meaningfulChanges,
}: {
  readonly data: DagNodeData;
  readonly meaningfulChanges: readonly (readonly [string, ChangeDesc])[];
}) {
  const changeGroups = groupChangesByCategory(meaningfulChanges);
  const changedFields = collectChangedFieldNames(meaningfulChanges);
  const unmodifiedState = data.resourceState
    ? filterUnmodifiedState(data.resourceState, changedFields)
    : {};
  const hasUnmodifiedState = Object.keys(unmodifiedState).length > 0;

  return (
    <>
      {changeGroups.map((group) => (
        <div key={group.label}>
          <SectionDivider label={group.label} />
          <div className="flex flex-col gap-2">
            {group.entries.map(([fieldPath, change]) => (
              <ChangeEntry key={fieldPath} fieldPath={fieldPath} change={change} />
            ))}
          </div>
        </div>
      ))}
      {hasUnmodifiedState && (
        <>
          <SectionDivider label="Unchanged" />
          <ResourceStateView resourceState={unmodifiedState} />
        </>
      )}
    </>
  );
}

function UnchangedBody({ data }: { readonly data: DagNodeData }) {
  const resourceState = data.resourceState ?? {};
  return <ResourceStateView resourceState={resourceState} />;
}

/** Build the raw data object for the disclosure section. */
const buildRawData = (
  data: DagNodeData,
): Readonly<Record<string, unknown>> | undefined => {
  const parts: Record<string, unknown> = {};
  if (data.resourceState !== undefined) parts["resourceState"] = data.resourceState;
  if (data.changes !== undefined) parts["changes"] = data.changes;
  if (Object.keys(parts).length === 0) return undefined;
  return parts;
};

function RawJsonDisclosure({ data }: { readonly data: DagNodeData }) {
  const [isOpen, setIsOpen] = useState(false);
  const rawData = buildRawData(data);

  if (rawData === undefined) return null;

  return (
    <div className="mt-4 border-t border-zinc-700/50 pt-3">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="flex w-full items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="currentColor"
          className={`h-3.5 w-3.5 transition-transform ${isOpen ? "rotate-90" : ""}`}
        >
          <title>Toggle raw JSON</title>
          <path
            fillRule="evenodd"
            d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z"
            clipRule="evenodd"
          />
        </svg>
        Raw JSON
      </button>
      {isOpen && (
        <pre className="mt-2 max-h-[400px] overflow-auto rounded border border-zinc-700/50 bg-zinc-950 p-3 font-mono text-xs text-zinc-400">
          {JSON.stringify(rawData, null, 2)}
        </pre>
      )}
    </div>
  );
}

const FORMAT_TOGGLE_LABELS: Readonly<Record<ValueFormat, string>> = {
  json: "JSON",
  yaml: "YAML",
};

const NEXT_FORMAT: Readonly<Record<ValueFormat, ValueFormat>> = {
  json: "yaml",
  yaml: "json",
};

function FormatToggle({
  format,
  onToggle,
}: {
  readonly format: ValueFormat;
  readonly onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="rounded border border-zinc-600 px-2 py-0.5 font-mono text-xs text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
    >
      {FORMAT_TOGGLE_LABELS[format]}
    </button>
  );
}

export function DetailPanel({ data, onClose }: DetailPanelProps) {
  const [valueFormat, setValueFormat] = useState<ValueFormat>("yaml");
  const meaningfulChanges = filterMeaningfulChanges(data.changes);

  const toggleFormat = () => setValueFormat((current) => NEXT_FORMAT[current]);

  return (
    <ValueFormatContext.Provider value={valueFormat}>
      <div className="flex h-full w-[380px] shrink-0 flex-col border-l border-zinc-700 bg-zinc-900">
        <div className="flex items-center justify-between border-b border-zinc-700/50 px-4 py-3">
          <h2 className="truncate text-sm font-semibold text-zinc-100">{data.label}</h2>
          <div className="ml-2 flex items-center gap-1.5">
            <FormatToggle format={valueFormat} onToggle={toggleFormat} />
            <button
              type="button"
              onClick={onClose}
              className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
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

        {data.diffState !== "added" && data.diffState !== "removed" && (
          <div className="px-4 py-2">
            <DiffStateBadge diffState={data.diffState} />
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-4 pb-4">
          {data.external && (
            <div className="mb-3 rounded border border-dashed border-zinc-600/60 bg-zinc-800/40 px-3 py-2 text-xs text-zinc-400">
              Untracked by this bundle
            </div>
          )}

          {data.nodeKind === "job" && data.taskChangeSummary !== undefined && (
            <TaskChangesSummary summary={data.taskChangeSummary} />
          )}

          {(data.diffState === "added" || data.diffState === "removed") && (
            <AddedOrRemovedBody data={data} />
          )}

          {data.diffState === "modified" && (
            <ModifiedBody data={data} meaningfulChanges={meaningfulChanges} />
          )}

          {data.diffState === "unchanged" && <UnchangedBody data={data} />}

          {data.diffState === "modified" &&
            meaningfulChanges.length === 0 &&
            data.resourceState === undefined &&
            data.taskChangeSummary === undefined && (
              <p className="py-8 text-center text-sm text-zinc-500">No changes</p>
            )}

          <RawJsonDisclosure data={data} />
        </div>
      </div>
    </ValueFormatContext.Provider>
  );
}
