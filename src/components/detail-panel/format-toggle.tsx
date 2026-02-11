import type { ValueFormat } from "../../utils/format-value.ts";

const FORMAT_TOGGLE_LABELS: Readonly<Record<ValueFormat, string>> = {
  json: "JSON",
  yaml: "YAML",
};

export const NEXT_FORMAT: Readonly<Record<ValueFormat, ValueFormat>> = {
  json: "yaml",
  yaml: "json",
};

export function FormatToggle({
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
      className="rounded border border-outline px-2 py-0.5 font-mono text-xs text-ink-muted hover:border-ink-faint hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      {FORMAT_TOGGLE_LABELS[format]}
    </button>
  );
}
