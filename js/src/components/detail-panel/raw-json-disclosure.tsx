import { useCallback, useMemo, useRef, useState } from "react";
import { usePlan } from "../../hooks/use-plan-context.ts";
import type { DagNodeData } from "../../types/graph-types.ts";
import {
  extractRawPlanSlice,
  type RawPlanSlice,
  type RawTaskSlice,
} from "../../utils/extract-raw-plan-entry.ts";
import { formatJsonBlockLabel } from "../../utils/format-json-block-label.ts";
import { CopyButton } from "./copy-button.tsx";
import { ExpandIcon } from "./json-block-icons.tsx";
import { JsonExpandModal } from "./json-expand-modal.tsx";

const PRE_CLASSES =
  "mt-2 max-h-[400px] overflow-auto rounded border border-outline-subtle bg-code-bg p-3 pr-10 font-mono text-xs text-ink-muted";

const TOOLBAR_CLASSES =
  "absolute right-2 top-4 flex gap-1 rounded bg-code-bg/80 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100";

const TOOLBAR_BUTTON_CLASSES =
  "rounded p-1 text-ink-muted hover:bg-surface-hover hover:text-ink-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

function JsonBlock({ data, label }: { readonly data: unknown; readonly label: string }) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const expandButtonRef = useRef<HTMLButtonElement>(null);

  const json = useMemo(() => JSON.stringify(data, null, 2), [data]);
  const getText = useCallback(() => json, [json]);
  const displayLabel = formatJsonBlockLabel(label);

  const handleCloseModal = useCallback(() => {
    setIsModalOpen(false);
    expandButtonRef.current?.focus();
  }, []);

  return (
    <div className="group relative">
      <pre className={PRE_CLASSES}>{json}</pre>
      <div className={TOOLBAR_CLASSES}>
        <CopyButton getText={getText} className={TOOLBAR_BUTTON_CLASSES} />
        <button
          ref={expandButtonRef}
          type="button"
          onClick={() => setIsModalOpen(true)}
          className={TOOLBAR_BUTTON_CLASSES}
          aria-label="Expand JSON"
        >
          <ExpandIcon />
        </button>
      </div>
      {isModalOpen && (
        <JsonExpandModal title={displayLabel} json={json} onClose={handleCloseModal} />
      )}
    </div>
  );
}

function SliceHeading({ label }: { readonly label: string }) {
  return <p className="mt-3 mb-1 font-mono text-xs text-ink-faint">{label}</p>;
}

function EntryView({ data, label }: { readonly data: unknown; readonly label: string }) {
  return <JsonBlock data={data} label={label} />;
}

function EntryWithSubsView({ entries }: { readonly entries: ReadonlyMap<string, unknown> }) {
  return (
    <>
      {[...entries].map(([key, value]) => (
        <div key={key}>
          <SliceHeading label={key} />
          <JsonBlock data={value} label={key} />
        </div>
      ))}
    </>
  );
}

function TaskSlicesView({ slices }: { readonly slices: readonly RawTaskSlice[] }) {
  return (
    <>
      {slices.map((slice) => (
        <div key={slice.label}>
          <SliceHeading label={slice.label} />
          <JsonBlock data={slice.data} label={slice.label} />
        </div>
      ))}
    </>
  );
}

function SliceContent({
  slice,
  resourceKey,
}: {
  readonly slice: RawPlanSlice;
  readonly resourceKey: string;
}) {
  switch (slice.kind) {
    case "entry":
      return <EntryView data={slice.data} label={resourceKey} />;
    case "entry-with-subs":
      return <EntryWithSubsView entries={slice.entries} />;
    case "task-slices":
      return <TaskSlicesView slices={slice.slices} />;
    default: {
      const _exhaustive: never = slice;
      return _exhaustive;
    }
  }
}

export function RawJsonDisclosure({ data }: { readonly data: DagNodeData }) {
  const [isOpen, setIsOpen] = useState(false);
  const plan = usePlan();

  const slice = useMemo(() => {
    if (!isOpen || plan === undefined) return undefined;
    return extractRawPlanSlice(plan, data);
  }, [isOpen, plan, data]);

  if (plan === undefined || data.nodeKind === "root" || data.nodeKind === "phantom") return null;

  return (
    <div className="mt-4 border-t border-outline-subtle pt-3">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="flex w-full items-center gap-1.5 rounded text-xs text-ink-muted hover:text-ink-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
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
      {isOpen && slice !== undefined && (
        <SliceContent slice={slice} resourceKey={data.resourceKey} />
      )}
    </div>
  );
}
