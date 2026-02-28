type PhantomLeafToggleProps = {
  readonly active: boolean;
  readonly onToggle: () => void;
  readonly count: number;
};

export function PhantomLeafToggle({ active, onToggle, count }: PhantomLeafToggleProps) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onToggle}
      className={`rounded-md border bg-surface-raised px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
        active
          ? "border-ink-muted text-ink"
          : "border-outline text-ink-muted hover:border-ink-muted/50 hover:text-ink"
      }`}
    >
      Inferred ({count})
    </button>
  );
}
