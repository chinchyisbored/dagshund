type ToolbarToggleProps = {
  readonly active: boolean;
  readonly onToggle: () => void;
  readonly label: string;
  readonly count: number;
  /** Hover tooltip explaining what the toggle does. */
  readonly title?: string;
  /** Border/text classes per pressed state; defaults are the neutral ink palette. */
  readonly activeClassName?: string;
  readonly inactiveClassName?: string;
};

/** Pressed-state count toggle for the canvas toolbar, rendered as "label (count)". */
export function ToolbarToggle({
  active,
  onToggle,
  label,
  count,
  title,
  activeClassName = "border-ink-muted text-ink",
  inactiveClassName = "border-outline text-ink-muted hover:border-ink-muted/50 hover:text-ink",
}: ToolbarToggleProps) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onToggle}
      title={title}
      className={`rounded-md border bg-surface-raised px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
        active ? activeClassName : inactiveClassName
      }`}
    >
      {label} ({count})
    </button>
  );
}
