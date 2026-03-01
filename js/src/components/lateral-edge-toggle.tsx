type LateralEdgeToggleProps = {
  readonly active: boolean;
  readonly onToggle: () => void;
  readonly count: number;
};

export function LateralEdgeToggle({ active, onToggle, count }: LateralEdgeToggleProps) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onToggle}
      className={`rounded-md border bg-surface-raised px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
        active
          ? "border-[var(--edge-lateral)] text-[var(--edge-lateral)]"
          : "border-outline text-ink-muted hover:border-[var(--edge-lateral)]/50 hover:text-[var(--edge-lateral)]"
      }`}
    >
      Lateral dependencies ({count})
    </button>
  );
}
