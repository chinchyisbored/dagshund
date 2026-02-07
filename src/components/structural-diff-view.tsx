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

function ScalarDiffView({ diff }: { readonly diff: ScalarDiff }) {
  return (
    <>
      <pre className="mb-1 overflow-x-auto rounded bg-red-500/5 px-2 py-1 font-mono text-xs text-red-300">
        - {formatValue(diff.old)}
      </pre>
      <pre className="overflow-x-auto rounded bg-emerald-500/5 px-2 py-1 font-mono text-xs text-emerald-300">
        + {formatValue(diff.new)}
      </pre>
    </>
  );
}

const ELEMENT_STATUS_STYLES: Readonly<
  Record<ArrayElement["status"], { readonly prefix: string; readonly className: string }>
> = {
  added: { prefix: "+", className: "bg-emerald-500/5 text-emerald-300" },
  removed: { prefix: "-", className: "bg-red-500/5 text-red-300" },
  unchanged: { prefix: " ", className: "text-zinc-500" },
};

function ArrayDiffView({ diff }: { readonly diff: ArrayDiff }) {
  return (
    <div className="flex flex-col gap-0.5">
      {diff.elements.map((element, index) => {
        const style = ELEMENT_STATUS_STYLES[element.status];
        return (
          <pre
            key={element.identityLabel ?? index}
            className={`overflow-x-auto rounded px-2 py-0.5 font-mono text-xs ${style.className}`}
          >
            {style.prefix} {formatValue(element.value)}
            {element.identityLabel !== undefined && element.status !== "unchanged" && (
              <span className="ml-2 text-zinc-500">({element.identityLabel})</span>
            )}
          </pre>
        );
      })}
    </div>
  );
}

const ENTRY_STATUS_STYLES: Readonly<
  Record<ObjectEntry["status"], { readonly className: string }>
> = {
  added: { className: "text-emerald-300" },
  removed: { className: "text-red-300" },
  changed: { className: "text-amber-300" },
  unchanged: { className: "text-zinc-500" },
};

function ObjectEntryView({ entry }: { readonly entry: ObjectEntry }) {
  const style = ENTRY_STATUS_STYLES[entry.status];

  if (entry.status === "changed") {
    return (
      <div className="flex flex-col gap-0.5">
        <pre className="overflow-x-auto rounded bg-red-500/5 px-2 py-0.5 font-mono text-xs text-red-300">
          - {entry.key}: {formatValue(entry.old)}
        </pre>
        <pre className="overflow-x-auto rounded bg-emerald-500/5 px-2 py-0.5 font-mono text-xs text-emerald-300">
          + {entry.key}: {formatValue(entry.new)}
        </pre>
      </div>
    );
  }

  const prefix = entry.status === "added" ? "+" : entry.status === "removed" ? "-" : " ";
  const value = entry.status === "removed" ? entry.old : entry.new;
  const background =
    entry.status === "added"
      ? "bg-emerald-500/5"
      : entry.status === "removed"
        ? "bg-red-500/5"
        : "";

  return (
    <pre
      className={`overflow-x-auto rounded px-2 py-0.5 font-mono text-xs ${style.className} ${background}`}
    >
      {prefix} {entry.key}: {formatValue(value)}
    </pre>
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
  return (
    <pre className="overflow-x-auto rounded bg-emerald-500/5 px-2 py-1 font-mono text-xs text-emerald-300">
      + {formatValue(diff.value)}
    </pre>
  );
}

function DeleteOnlyView({ diff }: { readonly diff: DeleteOnlyDiff }) {
  return (
    <pre className="overflow-x-auto rounded bg-red-500/5 px-2 py-1 font-mono text-xs text-red-300">
      - {formatValue(diff.value)}
    </pre>
  );
}

export function StructuralDiffView({ result }: StructuralDiffViewProps) {
  const { diff, baselineLabel } = result;
  return (
    <div>
      {baselineLabel === "remote" && (
        <span className="mb-1 block text-xs text-zinc-500">(vs remote)</span>
      )}
      {diff.kind === "scalar" && <ScalarDiffView diff={diff} />}
      {diff.kind === "array" && <ArrayDiffView diff={diff} />}
      {diff.kind === "object" && <ObjectDiffView diff={diff} />}
      {diff.kind === "create-only" && <CreateOnlyView diff={diff} />}
      {diff.kind === "delete-only" && <DeleteOnlyView diff={diff} />}
    </div>
  );
}
