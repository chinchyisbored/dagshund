import type { DiffState } from "../types/diff-state.ts";
import type { EdgeDiffState } from "../types/graph-types.ts";

export type DiffStateStyles = {
  readonly border: string;
  readonly borderStyle: string;
  readonly background: string;
  readonly text: string;
  readonly opacity: string;
};

const STYLES: Readonly<Record<DiffState, DiffStateStyles>> = {
  added: {
    border: "border-diff-added",
    borderStyle: "",
    background: "bg-diff-added-soft",
    text: "text-diff-added",
    opacity: "opacity-100",
  },
  removed: {
    border: "border-diff-removed",
    borderStyle: "border-dashed",
    background: "bg-diff-removed-soft",
    text: "text-diff-removed",
    opacity: "opacity-100",
  },
  modified: {
    border: "border-diff-modified",
    borderStyle: "",
    background: "bg-diff-modified-soft",
    text: "text-diff-modified",
    opacity: "opacity-100",
  },
  unchanged: {
    border: "border-diff-unchanged-border",
    borderStyle: "",
    background: "bg-diff-unchanged-bg",
    text: "text-diff-unchanged-text",
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

const EDGE_STYLES: Readonly<Record<EdgeDiffState, EdgeStyle>> = {
  added: { stroke: "var(--edge-added)", opacity: 1, strokeDasharray: undefined },
  removed: { stroke: "var(--edge-removed)", opacity: 1, strokeDasharray: "6 4" },
  unchanged: { stroke: "var(--edge-unchanged)", opacity: 1, strokeDasharray: undefined },
};

/** Get inline CSS style for an edge based on its diff state. Uses CSS variables directly so the browser resolves them reactively on theme change. */
export const getEdgeStyle = (state: EdgeDiffState): EdgeStyle => EDGE_STYLES[state];
