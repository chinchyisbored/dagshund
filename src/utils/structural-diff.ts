import type { ChangeDesc } from "../types/plan-schema.ts";
import type {
  ArrayDiff,
  ArrayElement,
  ObjectDiff,
  ObjectEntry,
  ObjectEntryStatus,
  StructuralDiffResult,
} from "../types/structural-diff.ts";

/** Deep equality check via JSON serialization. */
const deepEqual = (a: unknown, b: unknown): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

/** Check whether a value is a plain object (not null, not array). */
const isPlainObject = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

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
  const oldObjects = oldArr.filter(isPlainObject);
  const newObjects = newArr.filter(isPlainObject);
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
export const diffArrays = (
  oldArr: readonly unknown[],
  newArr: readonly unknown[],
): ArrayDiff => {
  const identityKey = findIdentityKey(oldArr, newArr);

  const getIdentity = (item: unknown): string | undefined => {
    if (identityKey === undefined) return undefined;
    if (!isPlainObject(item)) return undefined;
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

/** Sort order for object entry statuses: changed → added → removed → unchanged. */
const STATUS_ORDER: Readonly<Record<ObjectEntryStatus, number>> = {
  changed: 0,
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
      const status: ObjectEntryStatus = deepEqual(oldVal, newVal) ? "unchanged" : "changed";
      entries.push({ key, status, old: oldVal, new: newVal });
    } else if (hasNew) {
      entries.push({ key, status: "added", old: undefined, new: newVal });
    } else {
      entries.push({ key, status: "removed", old: oldVal, new: undefined });
    }
  }

  // Sort: changed → added → removed → unchanged
  entries.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);

  return { kind: "object", entries };
};

/**
 * Compute a structural diff for a single change description.
 *
 * Resolves the baseline (prefers `old`, falls back to `remote`), then
 * dispatches to array, object, or scalar diff depending on value types.
 */
export const computeStructuralDiff = (change: ChangeDesc): StructuralDiffResult => {
  // Create-only: no baseline to compare
  if (change.action === "create" && change.old === undefined && change.remote === undefined) {
    return {
      diff: { kind: "create-only", value: change.new },
      baselineLabel: "old",
    };
  }

  // Delete-only: no new value
  if (change.action === "delete" && change.new === undefined) {
    return {
      diff: { kind: "delete-only", value: change.old ?? change.remote },
      baselineLabel: change.old !== undefined ? "old" : "remote",
    };
  }

  // Resolve baseline
  const hasOld = change.old !== undefined;
  const baseline = hasOld ? change.old : change.remote;
  const baselineLabel = hasOld ? "old" : "remote" as const;
  const current = change.new;

  // If no baseline at all, treat as create-only
  if (baseline === undefined) {
    return {
      diff: { kind: "create-only", value: current },
      baselineLabel: "old",
    };
  }

  // If no current value, treat as delete-only
  if (current === undefined) {
    return {
      diff: { kind: "delete-only", value: baseline },
      baselineLabel,
    };
  }

  // Both arrays → array diff
  if (Array.isArray(baseline) && Array.isArray(current)) {
    return { diff: diffArrays(baseline, current), baselineLabel };
  }

  // Both plain objects → object diff
  if (isPlainObject(baseline) && isPlainObject(current)) {
    return { diff: diffObjects(baseline, current), baselineLabel };
  }

  // Scalar or type mismatch
  return {
    diff: { kind: "scalar", old: baseline, new: current },
    baselineLabel,
  };
};
