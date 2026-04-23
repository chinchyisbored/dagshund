import type { ChangeDesc } from "../types/plan-schema.ts";
import type {
  ArrayDiff,
  ArrayElement,
  ObjectDiff,
  ObjectEntry,
  ObjectEntryStatus,
  StructuralDiffResult,
} from "../types/structural-diff.ts";
import { extractListElementSemantic, type FieldChangeContext } from "./field-action.ts";
import { collectChangesForTask } from "./task-key.ts";
import { isUnknownRecord } from "./unknown-record.ts";

/** Key-order-independent deep equality check. */
export const deepEqual = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, i) => deepEqual(item, b[i]));
  }
  if (isUnknownRecord(a) && isUnknownRecord(b)) {
    const aKeys = Object.keys(a);
    if (aKeys.length !== Object.keys(b).length) return false;
    return aKeys.every((key) => key in b && deepEqual(a[key], b[key]));
  }
  return false;
};

/**
 * Detect a topology-drift change entry: a sub-entity defined in the bundle but
 * missing from the remote. Databricks encodes it as action=update, structurally
 * identical old and new, and no `remote` field at all (contrast with field-level
 * drift, which always has `remote` present).
 */
export const isTopologyDriftChange = (change: ChangeDesc): boolean =>
  change.action === "update" &&
  change.old !== undefined &&
  change.new !== undefined &&
  !("remote" in change) &&
  deepEqual(change.old, change.new);

/**
 * Shape-only predicate for field-level drift: both old and new are present
 * and equal, and remote is present with a different value. Action-agnostic,
 * so it's safe to reuse inside `computeStructuralDiff` where upstream
 * filtering (`filter-changes.ts`) has already removed noise actions.
 */
const isDriftSwapShape = (change: ChangeDesc): boolean =>
  "old" in change &&
  "new" in change &&
  "remote" in change &&
  deepEqual(change.old, change.new) &&
  !deepEqual(change.remote, change.old);

/**
 * Detect a field-level drift change entry: the bundle's view is unchanged
 * (`old == new`) but the remote has diverged from both. Databricks will
 * overwrite the remote with the bundle value on apply.
 *
 * Gated on `action === "update"` — the only field-level action Databricks
 * actually emits for drifted fields. Python's `has_drifted_field` formally
 * allows any non-unchanged action (update/update_id/recreate/resize), but
 * `recreate`/`resize`/`update_id` never appear at field level in real
 * plan.json output, so the narrower gate is equivalent in practice and
 * more honest about what the data shape actually contains. Also excludes
 * `action: "skip"` (server-side aliases like normalized enum values).
 */
export const isFieldDriftChange = (change: ChangeDesc): boolean =>
  change.action === "update" && isDriftSwapShape(change);

/** True for any drift shape — topology or field-level. */
export const isAnyDriftChange = (change: ChangeDesc): boolean =>
  isTopologyDriftChange(change) || isFieldDriftChange(change);

/** True for a list-element-delete change that the parent state reclassifies as
 *  drift because the enclosing resource shows shape-based drift. Mirrors the
 *  gate inside `computeStructuralDiff` and Python's `has_drifted_field` ctx
 *  branch (`src/dagshund/plan.py`). Exported for direct testing and for reuse
 *  from the ctx-aware predicates below (dagshund-15yh). */
export const isReclassifiedListElementDriftChange = (
  change: ChangeDesc,
  ctx: FieldChangeContext,
): boolean =>
  !("old" in change) &&
  !("new" in change) &&
  "remote" in change &&
  ctx.resourceHasShapeDrift &&
  extractListElementSemantic(ctx) === "delete";

/** True if any entry in the changes map is shape-based field drift (not topology).
 *  Gates list-element-delete → drift reclassification in `FieldChangeContext`
 *  so bundle rewires don't get over-flagged (dagshund-1naj). Mirrors Python's
 *  `resource_has_shape_drift` in `src/dagshund/plan.py`. */
export const hasFieldDrift = (changes: Readonly<Record<string, ChangeDesc>> | undefined): boolean =>
  changes !== undefined && Object.values(changes).some(isFieldDriftChange);

/** Per-resource state needed to recognize ctx-aware drift across many changes.
 *  Same shape as `FieldChangeContext` minus `changeKey`, which the predicates
 *  fill in per-change as they iterate. */
export type DriftScanParent = Omit<FieldChangeContext, "changeKey">;

/** Ctx-aware variant of `hasAnyDrift`: also recognizes reclassified-list-element
 *  delete drift gated on `parent.resourceHasShapeDrift`. Mirrors Python's
 *  `detect_manual_edits` ctx threading in `src/dagshund/plan.py` (dagshund-15yh). */
export const hasAnyDriftWithContext = (
  changes: Readonly<Record<string, ChangeDesc>> | undefined,
  parent: DriftScanParent,
): boolean => {
  if (changes === undefined) return false;
  for (const [key, change] of Object.entries(changes)) {
    if (isAnyDriftChange(change)) return true;
    if (isReclassifiedListElementDriftChange(change, { changeKey: key, ...parent })) return true;
  }
  return false;
};

/** Ctx-aware variant of `hasTaskDrift`. */
export const hasTaskDriftWithContext = (
  taskKey: string,
  changes: Readonly<Record<string, ChangeDesc>> | undefined,
  parent: DriftScanParent,
): boolean => {
  for (const [key, change] of collectChangesForTask(taskKey, changes)) {
    if (isAnyDriftChange(change)) return true;
    if (isReclassifiedListElementDriftChange(change, { changeKey: key, ...parent })) return true;
  }
  return false;
};

/**
 * Check whether a candidate key has unique string values within an array of objects.
 * Returns the count of elements that have this key with a string value, or 0 if duplicates exist.
 */
const countUniqueKeyInArray = (
  objects: readonly Readonly<Record<string, unknown>>[],
  key: string,
): number => {
  const values = new Set<string>();
  let count = 0;
  for (const obj of objects) {
    const value = obj[key];
    if (typeof value !== "string") continue;
    if (values.has(value)) return 0; // Duplicate — not a valid identity key
    values.add(value);
    count++;
  }
  return count;
};

/**
 * Auto-detect the best identity key from two arrays of elements.
 *
 * A valid identity key must have unique string values within each array independently
 * (old and new arrays are checked separately so shared values don't cause false negatives).
 * Picks the key present in the most total elements across both arrays.
 * Requires at least 2 elements total to have the key.
 */
export const findIdentityKey = (
  oldArr: readonly unknown[],
  newArr: readonly unknown[],
): string | undefined => {
  const oldObjects = oldArr.filter(isUnknownRecord);
  const newObjects = newArr.filter(isUnknownRecord);
  if (oldObjects.length + newObjects.length < 2) return undefined;

  // Gather all candidate keys (string-valued keys across all objects)
  const candidateKeys = new Set<string>();
  for (const obj of [...oldObjects, ...newObjects]) {
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === "string") candidateKeys.add(key);
    }
  }

  let bestKey: string | undefined;
  let bestCount = 0;

  for (const key of candidateKeys) {
    // Values must be unique within each array independently
    const oldCount = countUniqueKeyInArray(oldObjects, key);
    const newCount = countUniqueKeyInArray(newObjects, key);
    // If either array has duplicate values for this key, it's not viable
    if (oldObjects.length > 0 && oldCount === 0 && oldObjects.some((o) => key in o)) continue;
    if (newObjects.length > 0 && newCount === 0 && newObjects.some((o) => key in o)) continue;
    const totalCount = oldCount + newCount;
    if (totalCount < 2) continue;
    if (totalCount > bestCount) {
      bestCount = totalCount;
      bestKey = key;
    }
  }

  return bestKey;
};

/**
 * Diff two arrays by matching elements via an auto-detected identity key.
 * Falls back to deep-equality matching when no identity key is found.
 */
export const diffArrays = (oldArr: readonly unknown[], newArr: readonly unknown[]): ArrayDiff => {
  const identityKey = findIdentityKey(oldArr, newArr);

  const getIdentity = (item: unknown): string | undefined => {
    if (identityKey === undefined) return undefined;
    if (!isUnknownRecord(item)) return undefined;
    const value = item[identityKey];
    return typeof value === "string" ? value : undefined;
  };

  const elements: ArrayElement[] = [];

  // Build a lookup of old elements by identity
  const oldByIdentity = new Map<string, unknown>();
  const unmatchedOld: unknown[] = [];

  for (const item of oldArr) {
    const id = getIdentity(item);
    if (id !== undefined) {
      oldByIdentity.set(id, item);
    } else {
      unmatchedOld.push(item);
    }
  }

  // Process new elements: match by identity or deep-equality
  const matchedOldIdentities = new Set<string>();
  const matchedOldIndices = new Set<number>();

  for (const item of newArr) {
    const id = getIdentity(item);

    if (id !== undefined && oldByIdentity.has(id)) {
      // Matched by identity — unchanged
      matchedOldIdentities.add(id);
      elements.push({
        status: "unchanged",
        value: item,
        identityLabel: identityKey !== undefined ? `${identityKey}=${id}` : undefined,
      });
    } else if (id !== undefined) {
      // Has identity but not in old — added
      elements.push({
        status: "added",
        value: item,
        identityLabel: `${identityKey}=${id}`,
      });
    } else {
      // No identity key — try deep-equality match against unmatched old
      const matchIndex = unmatchedOld.findIndex(
        (oldItem, idx) => !matchedOldIndices.has(idx) && deepEqual(oldItem, item),
      );
      if (matchIndex !== -1) {
        matchedOldIndices.add(matchIndex);
        elements.push({ status: "unchanged", value: item, identityLabel: undefined });
      } else {
        elements.push({ status: "added", value: item, identityLabel: undefined });
      }
    }
  }

  // Remaining unmatched old elements are removed
  for (const [id, item] of oldByIdentity) {
    if (!matchedOldIdentities.has(id)) {
      elements.push({
        status: "removed",
        value: item,
        identityLabel: identityKey !== undefined ? `${identityKey}=${id}` : undefined,
      });
    }
  }

  for (const [idx, item] of unmatchedOld.entries()) {
    if (!matchedOldIndices.has(idx)) {
      elements.push({ status: "removed", value: item, identityLabel: undefined });
    }
  }

  return { kind: "array", elements };
};

/** Sort order for object entry statuses: modified → added → removed → unchanged. */
const STATUS_ORDER: Readonly<Record<ObjectEntryStatus, number>> = {
  modified: 0,
  added: 1,
  removed: 2,
  unchanged: 3,
};

/** Diff two plain objects by comparing keys. */
export const diffObjects = (
  oldObj: Readonly<Record<string, unknown>>,
  newObj: Readonly<Record<string, unknown>>,
): ObjectDiff => {
  const allKeys = new Set([...Object.keys(oldObj), ...Object.keys(newObj)]);
  const entries: ObjectEntry[] = [];

  for (const key of allKeys) {
    const hasOld = key in oldObj;
    const hasNew = key in newObj;
    const oldVal = oldObj[key];
    const newVal = newObj[key];

    if (hasOld && hasNew) {
      const status: ObjectEntryStatus = deepEqual(oldVal, newVal) ? "unchanged" : "modified";
      entries.push({ key, status, old: oldVal, new: newVal });
    } else if (hasNew) {
      entries.push({ key, status: "added", old: undefined, new: newVal });
    } else {
      entries.push({ key, status: "removed", old: oldVal, new: undefined });
    }
  }

  // Sort: modified → added → removed → unchanged
  const sorted = entries.toSorted((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);

  return { kind: "object", entries: sorted };
};

/**
 * Compute a structural diff for a single change description.
 *
 * Resolves the baseline (prefers `old`, falls back to `remote`), then
 * dispatches to array, object, or scalar diff depending on value types.
 *
 * Branch order matters:
 *   1. create-only for explicit create with no baseline,
 *   2. delete-only for explicit delete with no new,
 *   3. remote-only for fields the bundle does not manage,
 *   4. drift swap when old == new != remote,
 *   5. normal baseline-vs-current diff.
 */
export const computeStructuralDiff = (
  change: ChangeDesc,
  ctx?: FieldChangeContext,
): StructuralDiffResult => {
  // List-element reclassification: for bundle-managed lists the CLI emits
  // shapes that are ambiguous with unrelated semantics. When ctx lets us
  // disambiguate, take over ONLY when the shape would otherwise misclassify —
  // remote-only shape on a list-element path. Tag as drift when the enclosing
  // resource independently shows shape-based drift (dagshund-1naj).
  if (ctx !== undefined && !("old" in change) && !("new" in change) && "remote" in change) {
    const semantic = extractListElementSemantic(ctx);
    if (semantic === "delete") {
      return {
        kind: "diff",
        diff: { kind: "delete-only", value: change.remote },
        baselineLabel: "remote",
        semantic: isReclassifiedListElementDriftChange(change, ctx) ? "drift" : "normal",
      };
    }
    if (semantic === "create") {
      return {
        kind: "diff",
        diff: { kind: "create-only", value: change.remote },
        baselineLabel: "old",
        semantic: "normal",
      };
    }
  }

  // Create-only: no baseline to compare
  if (change.action === "create" && change.old === undefined && change.remote === undefined) {
    return {
      kind: "diff",
      diff: { kind: "create-only", value: change.new },
      baselineLabel: "old",
      semantic: "normal",
    };
  }

  // Delete-only: no new value
  if (change.action === "delete" && change.new === undefined) {
    return {
      kind: "diff",
      diff: { kind: "delete-only", value: change.old ?? change.remote },
      baselineLabel: change.old !== undefined ? "old" : "remote",
      semantic: "normal",
    };
  }

  // Remote-only: the bundle has no opinion on this field, the server does.
  // Uses `in` (not `!== undefined`) to correctly classify an explicit `remote: null`.
  if (!("old" in change) && !("new" in change) && "remote" in change) {
    return { kind: "remote-only", value: change.remote };
  }

  // Drift detection: when old == new, swap baseline to remote if it differs.
  // Uses `isDriftSwapShape` (shape only, no action gate) because noise actions
  // like "skip" are already filtered upstream in `filter-changes.ts` before a
  // change reaches `ChangeEntry` → `computeStructuralDiff`. Deliberately
  // broader than `isFieldDriftChange`, which gates on `action === "update"`
  // for classification purposes (e.g. `hasTaskDriftWithContext`).
  if (isDriftSwapShape(change)) {
    const baseline = change.remote;
    const current = change.new;

    if (Array.isArray(baseline) && Array.isArray(current)) {
      return {
        kind: "diff",
        diff: diffArrays(baseline, current),
        baselineLabel: "remote",
        semantic: "drift",
      };
    }
    if (isUnknownRecord(baseline) && isUnknownRecord(current)) {
      return {
        kind: "diff",
        diff: diffObjects(baseline, current),
        baselineLabel: "remote",
        semantic: "drift",
      };
    }
    return {
      kind: "diff",
      diff: { kind: "scalar", old: baseline, new: current },
      baselineLabel: "remote",
      semantic: "drift",
    };
  }

  // Resolve baseline
  const hasOld = change.old !== undefined;
  const baseline = hasOld ? change.old : change.remote;
  const baselineLabel = hasOld ? "old" : ("remote" as const);
  const current = change.new;

  // If no baseline at all, treat as create-only
  if (baseline === undefined) {
    return {
      kind: "diff",
      diff: { kind: "create-only", value: current },
      baselineLabel: "old",
      semantic: "normal",
    };
  }

  // If no current value, treat as delete-only
  if (current === undefined) {
    return {
      kind: "diff",
      diff: { kind: "delete-only", value: baseline },
      baselineLabel,
      semantic: "normal",
    };
  }

  // Both arrays → array diff
  if (Array.isArray(baseline) && Array.isArray(current)) {
    return {
      kind: "diff",
      diff: diffArrays(baseline, current),
      baselineLabel,
      semantic: "normal",
    };
  }

  // Both plain objects → object diff
  if (isUnknownRecord(baseline) && isUnknownRecord(current)) {
    return {
      kind: "diff",
      diff: diffObjects(baseline, current),
      baselineLabel,
      semantic: "normal",
    };
  }

  // Scalar or type mismatch
  return {
    kind: "diff",
    diff: { kind: "scalar", old: baseline, new: current },
    baselineLabel,
    semantic: "normal",
  };
};
