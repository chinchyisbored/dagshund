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

/** Read a CSS custom property from the document root. */
const getCssVar = (name: string): string =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** Get inline CSS style for an edge based on its resolved state, reading themed CSS variables. */
export const getEdgeStyle = (state: EdgeDiffState): EdgeStyle => {
  const styleMap: Readonly<Record<EdgeDiffState, { readonly varName: string; readonly strokeDasharray: string | undefined }>> = {
    added: { varName: "--edge-added", strokeDasharray: undefined },
    removed: { varName: "--edge-removed", strokeDasharray: "6 4" },
    unchanged: { varName: "--edge-unchanged", strokeDasharray: undefined },
  };
  const config = styleMap[state];
  return {
    stroke: getCssVar(config.varName),
    opacity: 1,
    strokeDasharray: config.strokeDasharray,
  };
};
