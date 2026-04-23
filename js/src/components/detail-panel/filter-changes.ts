import type { ChangeDesc } from "../../types/plan-schema.ts";
import {
  type DriftScanParent,
  deepEqual,
  isReclassifiedListElementDriftChange,
  isTopologyDriftChange,
} from "../../utils/structural-diff.ts";

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
  /** Topology drift: sub-entity in bundle, missing from remote (will be re-added on apply). */
  readonly driftReentryChanges: Readonly<Record<string, ChangeDesc>>;
  /** List-element drift: element on remote, missing from bundle, in a shape-drifted
   *  resource (will be removed on apply). */
  readonly driftRemovalChanges: Readonly<Record<string, ChangeDesc>>;
  /** Everything else (field-level diffs and field-level drift). */
  readonly fieldChanges: readonly ChangeEntry[];
  /** Union of all bucket keys in insertion order. Convenience for `excludePaths`
   *  on the Unchanged section so drift-hoisted entries don't double-render. */
  readonly allChangePaths: readonly string[];
};

/**
 * Filter noise/no-op entries, then partition the remainder into three buckets:
 * drift re-entry (topology), drift removal (reclassified list-element delete),
 * and field changes. Also returns `allChangePaths` for Unchanged exclusion.
 *
 * `parent` is required — the reclassified-list-element-drift predicate needs
 * the resource's new/remote state to disambiguate shapes that would otherwise
 * look like plain `fieldChanges`. Callers always have this via DagNodeData.
 */
export const splitMeaningfulChanges = (
  changes: Readonly<Record<string, ChangeDesc>> | undefined,
  parent: DriftScanParent,
): MeaningfulChangeSplit => {
  if (changes === undefined) {
    return {
      driftReentryChanges: {},
      driftRemovalChanges: {},
      fieldChanges: [],
      allChangePaths: [],
    };
  }

  const driftReentryChanges: Record<string, ChangeDesc> = {};
  const driftRemovalChanges: Record<string, ChangeDesc> = {};
  const fieldChanges: ChangeEntry[] = [];
  const allChangePaths: string[] = [];

  for (const [key, change] of Object.entries(changes)) {
    if (NOISE_ACTIONS.has(change.action)) continue;
    if (isNoOpChange(change)) continue;

    if (isTopologyDriftChange(change)) {
      driftReentryChanges[key] = change;
    } else if (isReclassifiedListElementDriftChange(change, { changeKey: key, ...parent })) {
      driftRemovalChanges[key] = change;
    } else {
      fieldChanges.push([key, change]);
    }
    allChangePaths.push(key);
  }

  return { driftReentryChanges, driftRemovalChanges, fieldChanges, allChangePaths };
};
