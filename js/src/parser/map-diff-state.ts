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
