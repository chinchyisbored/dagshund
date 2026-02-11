import type { DiffState } from "../types/diff-state.ts";

export type FilterableDiffState = Exclude<DiffState, "unchanged">;

type FilterButton = {
  readonly state: FilterableDiffState;
  readonly label: string;
  readonly activeClasses: string;
  readonly inactiveClasses: string;
};

const FILTER_BUTTONS: readonly FilterButton[] = [
  {
    state: "added",
    label: "Added",
    activeClasses: "bg-diff-added-soft border-diff-added text-diff-added",
    inactiveClasses: "border-outline text-ink-muted hover:border-diff-added/50 hover:text-diff-added",
  },
  {
    state: "modified",
    label: "Modified",
    activeClasses: "bg-diff-modified-soft border-diff-modified text-diff-modified",
    inactiveClasses: "border-outline text-ink-muted hover:border-diff-modified/50 hover:text-diff-modified",
  },
  {
    state: "removed",
    label: "Removed",
    activeClasses: "bg-diff-removed-soft border-diff-removed text-diff-removed",
    inactiveClasses: "border-outline text-ink-muted hover:border-diff-removed/50 hover:text-diff-removed",
  },
];

type DiffFilterToolbarProps = {
  readonly activeFilter: DiffState | null;
  readonly onFilterChange: (state: DiffState | null) => void;
  readonly diffStateCounts: Readonly<Record<FilterableDiffState, number>>;
};

export function DiffFilterToolbar({ activeFilter, onFilterChange, diffStateCounts }: DiffFilterToolbarProps) {
  return (
    <div className="flex gap-1.5">
      {FILTER_BUTTONS.map((button) => {
        const count = diffStateCounts[button.state];
        const isActive = activeFilter === button.state;
        const isDisabled = count === 0;
        return (
          <button
            key={button.state}
            type="button"
            aria-pressed={isActive}
            disabled={isDisabled}
            onClick={() => onFilterChange(isActive ? null : button.state)}
            className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
              isDisabled
                ? "cursor-default border-outline text-ink-muted opacity-40"
                : isActive
                  ? button.activeClasses
                  : button.inactiveClasses
            }`}
          >
            {button.label} ({count})
          </button>
        );
      })}
    </div>
  );
}
