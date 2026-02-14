import { useState } from "react";
import type { DagNodeData } from "../../types/graph-types.ts";

/** Build the raw data object for the disclosure section. */
const buildRawData = (data: DagNodeData): Readonly<Record<string, unknown>> | undefined => {
  const parts: Record<string, unknown> = {};
  if (data.resourceState !== undefined) parts["resourceState"] = data.resourceState;
  if (data.changes !== undefined) parts["changes"] = data.changes;
  if (Object.keys(parts).length === 0) return undefined;
  return parts;
};

export function RawJsonDisclosure({ data }: { readonly data: DagNodeData }) {
  const [isOpen, setIsOpen] = useState(false);
  const rawData = buildRawData(data);

  if (rawData === undefined) return null;

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
      {isOpen && (
        <pre className="mt-2 max-h-[400px] overflow-auto rounded border border-outline-subtle bg-code-bg p-3 font-mono text-xs text-ink-muted">
          {JSON.stringify(rawData, null, 2)}
        </pre>
      )}
    </div>
  );
}
