import type { DiffState } from "../types/diff-state.ts";

type FilterableDiffState = Exclude<DiffState, "unchanged">;

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
    activeClasses: "bg-emerald-500/20 border-emerald-500 text-emerald-300",
    inactiveClasses: "border-zinc-600 text-zinc-400 hover:border-emerald-500/50 hover:text-emerald-400",
  },
  {
    state: "modified",
    label: "Modified",
    activeClasses: "bg-amber-500/20 border-amber-500 text-amber-300",
    inactiveClasses: "border-zinc-600 text-zinc-400 hover:border-amber-500/50 hover:text-amber-400",
  },
  {
    state: "removed",
    label: "Removed",
    activeClasses: "bg-red-500/20 border-red-500 text-red-400",
    inactiveClasses: "border-zinc-600 text-zinc-400 hover:border-red-500/50 hover:text-red-400",
  },
];

type DiffFilterToolbarProps = {
  readonly activeFilter: DiffState | null;
  readonly onFilterChange: (state: DiffState | null) => void;
};

export function DiffFilterToolbar({ activeFilter, onFilterChange }: DiffFilterToolbarProps) {
  return (
    <div className="flex gap-1.5">
      {FILTER_BUTTONS.map((button) => {
        const isActive = activeFilter === button.state;
        return (
          <button
            key={button.state}
            type="button"
            onClick={() => onFilterChange(isActive ? null : button.state)}
            className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
              isActive ? button.activeClasses : button.inactiveClasses
            }`}
          >
            {button.label}
          </button>
        );
      })}
    </div>
  );
}
