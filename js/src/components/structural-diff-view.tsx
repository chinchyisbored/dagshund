import { useValueFormat } from "../hooks/use-value-format.ts";
import type {
  ArrayDiff,
  ArrayElement,
  CreateOnlyDiff,
  DeleteOnlyDiff,
  ObjectDiff,
  ObjectEntry,
  ScalarDiff,
  StructuralDiffResult,
} from "../types/structural-diff.ts";
import { formatValue } from "../utils/format-value.ts";

type StructuralDiffViewProps = {
  readonly result: StructuralDiffResult;
};

/** Characters after which the browser may break a long line. */
const BREAK_OPPORTUNITY_PATTERN = /([ /\-_.,@])/;

/** Insert zero-width break opportunities after common delimiter characters,
 *  so CSS wrapping favours natural boundaries over mid-word breaks. */
const insertBreakOpportunities = (text: string): React.ReactNode => {
  const parts = text.split(BREAK_OPPORTUNITY_PATTERN);
  if (parts.length <= 1) return text;
  return parts.map((part, i) => (
    // biome-ignore lint/suspicious/noArrayIndexKey: text fragment indices are stable
    <span key={i}>
      {part}
      {i % 2 === 1 ? <wbr /> : null}
    </span>
  ));
};

/** Render formatted text with prefix pinned in a fixed-width column.
 *  Content wraps naturally via CSS within its own column, so the prefix
 *  alignment is preserved regardless of panel width. */
export function PrefixedBlock({
  prefix,
  text,
  className,
}: {
  readonly prefix: string;
  readonly text: string;
  readonly className: string;
}) {
  const lines = text.split("\n");

  return (
    <>
      {lines.map((line, i) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: line indices are stable
          key={i}
          className={`grid font-mono text-xs ${className}`}
          style={{ gridTemplateColumns: `${prefix.length}ch 1fr` }}
        >
          <span className="whitespace-pre">{prefix}</span>
          <span className="whitespace-pre-wrap break-words">{insertBreakOpportunities(line)}</span>
        </div>
      ))}
    </>
  );
}

/** Indent each line of text by a fixed string. */
const indentText = (text: string, indent: string): string =>
  text
    .split("\n")
    .map((line) => `${indent}${line}`)
    .join("\n");

/** Build display text for a key-value entry: inline for scalars, split+indented for compound values. */
const buildEntryText = (key: string, formatted: string): string =>
  formatted.includes("\n") ? `${key}:\n${indentText(formatted, "  ")}` : `${key}: ${formatted}`;

function ScalarDiffView({ diff }: { readonly diff: ScalarDiff }) {
  const format = useValueFormat();
  return (
    <>
      <div className="mb-1 rounded bg-diff-removed-soft px-2 py-1">
        <PrefixedBlock
          prefix="- "
          text={formatValue(diff.old, format)}
          className="text-diff-removed"
        />
      </div>
      <div className="rounded bg-diff-added-soft px-2 py-1">
        <PrefixedBlock
          prefix="+ "
          text={formatValue(diff.new, format)}
          className="text-diff-added"
        />
      </div>
    </>
  );
}

const ELEMENT_STATUS_STYLES: Readonly<
  Record<ArrayElement["status"], { readonly prefix: string; readonly className: string }>
> = {
  added: { prefix: "+", className: "text-diff-added" },
  removed: { prefix: "-", className: "text-diff-removed" },
  unchanged: { prefix: " ", className: "text-ink-muted" },
};

const ELEMENT_BACKGROUND: Readonly<Record<ArrayElement["status"], string>> = {
  added: "bg-diff-added-soft",
  removed: "bg-diff-removed-soft",
  unchanged: "",
};

function ArrayDiffView({ diff }: { readonly diff: ArrayDiff }) {
  const format = useValueFormat();
  return (
    <div className="flex flex-col gap-0.5">
      {diff.elements.map((element, index) => {
        const style = ELEMENT_STATUS_STYLES[element.status];
        const bg = ELEMENT_BACKGROUND[element.status];
        const formatted = formatValue(element.value, format);
        return (
          <div key={element.identityLabel ?? index} className={`rounded px-2 py-0.5 ${bg}`}>
            <PrefixedBlock
              prefix={`${style.prefix} `}
              text={formatted}
              className={style.className}
            />
          </div>
        );
      })}
    </div>
  );
}

const ENTRY_STATUS_STYLES: Readonly<Record<ObjectEntry["status"], { readonly className: string }>> =
  {
    added: { className: "text-diff-added" },
    removed: { className: "text-diff-removed" },
    modified: { className: "text-diff-modified" },
    unchanged: { className: "text-ink-muted" },
  };

const ENTRY_BACKGROUND: Readonly<Record<ObjectEntry["status"], string>> = {
  added: "bg-diff-added-soft",
  removed: "bg-diff-removed-soft",
  modified: "",
  unchanged: "",
};

function ModifiedEntryView({ entry }: { readonly entry: ObjectEntry }) {
  const format = useValueFormat();
  const formattedOld = formatValue(entry.old, format);
  const formattedNew = formatValue(entry.new, format);

  return (
    <div className="flex flex-col gap-0.5">
      <div className="rounded bg-diff-removed-soft px-2 py-0.5">
        <PrefixedBlock
          prefix="- "
          text={buildEntryText(entry.key, formattedOld)}
          className="text-diff-removed"
        />
      </div>
      <div className="rounded bg-diff-added-soft px-2 py-0.5">
        <PrefixedBlock
          prefix="+ "
          text={buildEntryText(entry.key, formattedNew)}
          className="text-diff-added"
        />
      </div>
    </div>
  );
}

function ObjectEntryView({ entry }: { readonly entry: ObjectEntry }) {
  const format = useValueFormat();
  const style = ENTRY_STATUS_STYLES[entry.status];

  if (entry.status === "modified") {
    return <ModifiedEntryView entry={entry} />;
  }

  const prefix = entry.status === "added" ? "+" : entry.status === "removed" ? "-" : " ";
  const value = entry.status === "removed" ? entry.old : entry.new;
  const formatted = formatValue(value, format);
  const bg = ENTRY_BACKGROUND[entry.status];

  return (
    <div className={`rounded px-2 py-0.5 ${bg}`}>
      <PrefixedBlock
        prefix={`${prefix} `}
        text={buildEntryText(entry.key, formatted)}
        className={style.className}
      />
    </div>
  );
}

function ObjectDiffView({ diff }: { readonly diff: ObjectDiff }) {
  return (
    <div className="flex flex-col gap-0.5">
      {diff.entries.map((entry) => (
        <ObjectEntryView key={entry.key} entry={entry} />
      ))}
    </div>
  );
}

function CreateOnlyView({ diff }: { readonly diff: CreateOnlyDiff }) {
  const format = useValueFormat();
  return (
    <div className="rounded bg-diff-added-soft px-2 py-1">
      <PrefixedBlock
        prefix="+ "
        text={formatValue(diff.value, format)}
        className="text-diff-added"
      />
    </div>
  );
}

function DeleteOnlyView({ diff }: { readonly diff: DeleteOnlyDiff }) {
  const format = useValueFormat();
  return (
    <div className="rounded bg-diff-removed-soft px-2 py-1">
      <PrefixedBlock
        prefix="- "
        text={formatValue(diff.value, format)}
        className="text-diff-removed"
      />
    </div>
  );
}

export function StructuralDiffView({ result }: StructuralDiffViewProps) {
  const { diff, baselineLabel } = result;
  return (
    <div>
      {baselineLabel === "remote" && (
        <span className="mb-1 block text-xs text-ink-muted">(vs remote)</span>
      )}
      {diff.kind === "scalar" && <ScalarDiffView diff={diff} />}
      {diff.kind === "array" && <ArrayDiffView diff={diff} />}
      {diff.kind === "object" && <ObjectDiffView diff={diff} />}
      {diff.kind === "create-only" && <CreateOnlyView diff={diff} />}
      {diff.kind === "delete-only" && <DeleteOnlyView diff={diff} />}
    </div>
  );
}
