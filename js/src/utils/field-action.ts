import type { ActionType, ChangeDesc } from "../types/plan-schema.ts";

/** Actions that treat sub-field changes as part of an update — mirrors
 *  ACTIONS[...].show_field_changes == True in src/dagshund/format.py. */
const FIELD_CHANGE_ACTIONS: ReadonlySet<ActionType> = new Set([
  "update",
  "update_id",
  "recreate",
  "resize",
]);

/**
 * Derive the display action for a field-level change from the shape of the
 * data, not from `change.action`. The Databricks CLI reports "update" for
 * every field inside an updated resource even when the field itself is new,
 * removed, or remote-only. This mirrors `field_action_config` in
 * src/dagshund/format.py so the browser badge matches the CLI's per-field
 * symbol/label.
 */
export const deriveFieldAction = (change: ChangeDesc): string => {
  // Only update-family actions get shape-derived overrides — create/delete/
  // skip/unknown are resource-level and already correct.
  if (!FIELD_CHANGE_ACTIONS.has(change.action)) {
    return change.action;
  }

  const hasOld = "old" in change;
  const hasNew = "new" in change;
  const hasRemote = "remote" in change;

  if (hasNew && !hasOld) return "create";
  if (hasOld && !hasNew) return "delete";
  if (!hasOld && !hasNew && hasRemote) return "remote";
  return change.action;
};
