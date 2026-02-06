import type { DiffState } from "../types/diff-state.ts";

export type DiffStateStyles = {
  readonly border: string;
  readonly background: string;
  readonly text: string;
  readonly opacity: string;
};

const STYLES: Readonly<Record<DiffState, DiffStateStyles>> = {
  added: {
    border: "border-emerald-500",
    background: "bg-emerald-500/10",
    text: "text-emerald-300",
    opacity: "opacity-100",
  },
  removed: {
    border: "border-red-500",
    background: "bg-red-500/10",
    text: "text-red-400",
    opacity: "opacity-40",
  },
  modified: {
    border: "border-amber-500",
    background: "bg-amber-500/10",
    text: "text-amber-300",
    opacity: "opacity-100",
  },
  unchanged: {
    border: "border-zinc-600",
    background: "bg-zinc-800",
    text: "text-zinc-300",
    opacity: "opacity-100",
  },
};

/** Get Tailwind class bundles for a given diff state. */
export const getDiffStateStyles = (diffState: DiffState): DiffStateStyles =>
  STYLES[diffState];
