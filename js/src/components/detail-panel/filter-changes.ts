import type { ChangeDesc } from "../../types/plan-schema.ts";
import { deepEqual, isTopologyDriftChange } from "../../utils/structural-diff.ts";

const NOISE_ACTIONS: ReadonlySet<string> = new Set(["skip", ""]);

/**
 * Detect no-op changes where old == new with no meaningful remote difference.
 *
 * Topology drift (old == new, no `remote` field) is meaningful and must NOT be
 * filtered out — it represents a sub-entity missing from the remote that will
 * be re-added on apply.
 */
export const isNoOpChange = (change: ChangeDesc): boolean => {
  if (isTopologyDriftChange(change)) return false;
  if (change.old === undefined || change.new === undefined) return false;
  if (!deepEqual(change.old, change.new)) return false;
  // Field-level drift (remote differs) is also meaningful
  if (change.remote !== undefined && !deepEqual(change.remote, change.old)) return false;
  return true;
};

export type ChangeEntry = readonly [string, ChangeDesc];

export type MeaningfulChangeSplit = {
  readonly driftChanges: Readonly<Record<string, ChangeDesc>>;
  readonly fieldChanges: readonly ChangeEntry[];
};

/**
 * Filter noise/no-op entries, then partition the remainder into:
 *  - `driftChanges`: topology-drift entries (re-added on apply)
 *  - `fieldChanges`: everything else (field-level diffs and drift)
 */
export const splitMeaningfulChanges = (
  changes: Readonly<Record<string, ChangeDesc>> | undefined,
): MeaningfulChangeSplit => {
  if (changes === undefined) return { driftChanges: {}, fieldChanges: [] };

  const driftChanges: Record<string, ChangeDesc> = {};
  const fieldChanges: ChangeEntry[] = [];

  for (const [key, change] of Object.entries(changes)) {
    if (NOISE_ACTIONS.has(change.action)) continue;
    if (isNoOpChange(change)) continue;
    if (isTopologyDriftChange(change)) {
      driftChanges[key] = change;
      continue;
    }
    fieldChanges.push([key, change]);
  }

  return { driftChanges, fieldChanges };
};
