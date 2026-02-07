import type { DiffState } from "../types/diff-state.ts";

export type DiffStateStyles = {
  readonly border: string;
  readonly borderStyle: string;
  readonly background: string;
  readonly text: string;
  readonly opacity: string;
};

const STYLES: Readonly<Record<DiffState, DiffStateStyles>> = {
  added: {
    border: "border-emerald-500",
    borderStyle: "",
    background: "bg-emerald-500/10",
    text: "text-emerald-300",
    opacity: "opacity-100",
  },
  removed: {
    border: "border-red-500",
    borderStyle: "border-dashed",
    background: "bg-red-500/10",
    text: "text-red-400",
    opacity: "opacity-100",
  },
  modified: {
    border: "border-amber-500",
    borderStyle: "",
    background: "bg-amber-500/10",
    text: "text-amber-300",
    opacity: "opacity-100",
  },
  unchanged: {
    border: "border-zinc-600",
    borderStyle: "",
    background: "bg-zinc-800",
    text: "text-zinc-300",
    opacity: "opacity-100",
  },
};

/** Get Tailwind class bundles for a given diff state. */
export const getDiffStateStyles = (diffState: DiffState): DiffStateStyles => STYLES[diffState];

export type EdgeStyle = {
  readonly stroke: string;
  readonly opacity: number;
  readonly strokeDasharray: string | undefined;
};

const EDGE_STYLES: Readonly<Record<"added" | "removed" | "unchanged", EdgeStyle>> = {
  added: { stroke: "#10b981", opacity: 1, strokeDasharray: undefined },
  removed: { stroke: "#ef4444", opacity: 1, strokeDasharray: "6 4" },
  unchanged: { stroke: "#52525b", opacity: 1, strokeDasharray: undefined },
};

/** Get inline CSS style for an edge based on its resolved state. */
export const getEdgeStyle = (state: "added" | "removed" | "unchanged"): EdgeStyle => EDGE_STYLES[state];
