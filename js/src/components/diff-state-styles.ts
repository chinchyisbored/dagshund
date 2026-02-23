import type { DiffState } from "../types/diff-state.ts";
import type { EdgeDiffState } from "../types/graph-types.ts";

export type DiffStateStyles = {
  readonly border: string;
  readonly borderStyle: string;
  readonly background: string;
  readonly text: string;
  readonly opacity: string;
  readonly hoverGlow: string;
};

const STYLES: Readonly<Record<DiffState, DiffStateStyles>> = {
  added: {
    border: "border-diff-added",
    borderStyle: "",
    background: "bg-diff-added-soft",
    text: "text-diff-added",
    opacity: "opacity-100",
    hoverGlow: "var(--diff-added)",
  },
  removed: {
    border: "border-diff-removed",
    borderStyle: "",
    background: "bg-diff-removed-soft",
    text: "text-diff-removed",
    opacity: "opacity-100",
    hoverGlow: "var(--diff-removed)",
  },
  modified: {
    border: "border-diff-modified",
    borderStyle: "",
    background: "bg-diff-modified-soft",
    text: "text-diff-modified",
    opacity: "opacity-100",
    hoverGlow: "var(--diff-modified)",
  },
  unchanged: {
    border: "border-diff-unchanged-border",
    borderStyle: "",
    background: "bg-diff-unchanged-bg",
    text: "text-diff-unchanged-text",
    opacity: "opacity-100",
    hoverGlow: "var(--diff-unchanged-border)",
  },
};

/** Get Tailwind class bundles for a given diff state. */
export const getDiffStateStyles = (diffState: DiffState): DiffStateStyles => STYLES[diffState];

/** Non-color diff indicator prefix for color-blind accessibility. Returns undefined for unchanged. */
const DIFF_BADGES: Readonly<Record<DiffState, string | undefined>> = {
  added: "+",
  removed: "\u2212",
  modified: "~",
  unchanged: undefined,
};

export const getDiffBadge = (diffState: DiffState): string | undefined => DIFF_BADGES[diffState];

export type EdgeStyle = {
  readonly stroke: string;
  readonly opacity: number;
  readonly strokeDasharray: string | undefined;
};

const EDGE_STYLES: Readonly<Record<EdgeDiffState, EdgeStyle>> = {
  added: { stroke: "var(--edge-added)", opacity: 1, strokeDasharray: undefined },
  removed: { stroke: "var(--edge-removed)", opacity: 1, strokeDasharray: "6 4" },
  unchanged: { stroke: "var(--edge-unchanged)", opacity: 1, strokeDasharray: undefined },
};

const SYNC_EDGE_STYLE: EdgeStyle = {
  stroke: "var(--edge-sync)",
  opacity: 0.85,
  strokeDasharray: "6 4",
};

/** Get inline CSS style for an edge based on its diff state and optional kind. Uses CSS variables directly so the browser resolves them reactively on theme change. */
export const getEdgeStyle = (state: EdgeDiffState, edgeKind?: "sync"): EdgeStyle =>
  edgeKind === "sync" ? SYNC_EDGE_STYLE : EDGE_STYLES[state];
