import type { DiffState } from "../types/diff-state.ts";
import type { ActionType } from "../types/plan-schema.ts";

const ACTION_TO_DIFF_STATE: Readonly<Record<ActionType, DiffState>> = {
  "": "unchanged",
  skip: "unchanged",
  create: "added",
  delete: "removed",
  update: "modified",
  resize: "modified",
  recreate: "modified",
  update_id: "modified",
  unknown: "unknown",
};

export const mapActionToDiffState = (action: ActionType | undefined): DiffState =>
  action === undefined ? "unchanged" : ACTION_TO_DIFF_STATE[action];

export const isStateCleanup = (entry: {
  readonly action?: ActionType;
  readonly gone?: unknown;
  readonly state_only?: unknown;
  readonly stateCleanups?: readonly unknown[];
}): boolean => entry.action === "delete" && (entry.gone === true || entry.state_only === true);

export const mapEntryToDiffState = (entry: {
  readonly action?: ActionType;
  readonly gone?: unknown;
  readonly state_only?: unknown;
  readonly stateCleanups?: readonly unknown[];
}): DiffState =>
  isStateCleanup(entry) ||
  ((entry.action === undefined || entry.action === "" || entry.action === "skip") &&
    (entry.stateCleanups?.length ?? 0) > 0)
    ? "modified"
    : mapActionToDiffState(entry.action);
