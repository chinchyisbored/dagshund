import { useValueFormat } from "../../hooks/use-value-format.ts";
import { formatValue } from "../../utils/format-value.ts";

/** CSS hanging indent: first visual line at col 0, wrapped continuations at 4ch. */
const VALUE_HANGING_INDENT = { paddingLeft: "4ch", textIndent: "-4ch" } as const;

export function ResourceStateView({
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
          <div
            key={key}
            className="rounded border border-outline-subtle bg-surface-raised/30 px-3 py-2"
          >
            <span className="font-mono text-xs text-ink-secondary">{key}</span>
            <div className="mt-1">
              {formatted.split("\n").map((line, i) => (
                <div
                  // biome-ignore lint/suspicious/noArrayIndexKey: lines from split() have no stable ID
                  key={i}
                  className="whitespace-pre-wrap break-words font-mono text-xs text-ink-muted"
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
