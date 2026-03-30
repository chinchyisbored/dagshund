import { findIdentityKey } from "./structural-diff.ts";
import { stripTaskPrefix } from "./task-key.ts";
import { isUnknownRecord } from "./unknown-record.ts";

/** Find the earliest non-negative index, or -1 if both are absent. */
const earliestIndex = (a: number, b: number): number => {
  if (a === -1) return b;
  if (b === -1) return a;
  return Math.min(a, b);
};

/** Extract the top-level field name from a change path.
 *  Splits at the first `.` or `[`, whichever comes first.
 *  e.g. `depends_on[0].task_key` → `depends_on`, `notebook_task.path` → `notebook_task` */
export const topLevelFieldName = (path: string): string => {
  const stripped = stripTaskPrefix(path);
  const splitAt = earliestIndex(stripped.indexOf("."), stripped.indexOf("["));
  return splitAt === -1 ? stripped : stripped.slice(0, splitAt);
};

/** Extract the path relative to the top-level field name, or undefined for direct field changes.
 *  For dot splits, skips the dot; for bracket splits, includes the bracket.
 *  e.g. `depends_on[0].task_key` → `[0].task_key`, `notebook_task.path` → `path` */
export const extractRelativeChangePath = (path: string): string | undefined => {
  const stripped = stripTaskPrefix(path);
  const splitAt = earliestIndex(stripped.indexOf("."), stripped.indexOf("["));
  if (splitAt === -1) return undefined;
  return stripped[splitAt] === "." ? stripped.slice(splitAt + 1) : stripped.slice(splitAt);
};

/** Parse bracket expressions like `[field='value']` from a path segment. */
const BRACKET_PATTERN = /\[(\w+)='([^']+)'\]/g;

export const parseBracketFilters = (
  segment: string,
): readonly { readonly field: string; readonly value: string }[] => {
  const filters: { field: string; value: string }[] = [];
  for (const match of segment.matchAll(BRACKET_PATTERN)) {
    if (match[1] !== undefined && match[2] !== undefined) {
      filters.push({ field: match[1], value: match[2] });
    }
  }
  return filters;
};

/** Check if a record matches all bracket filters. */
export const matchesAllFilters = (
  record: unknown,
  filters: readonly { readonly field: string; readonly value: string }[],
): boolean => {
  if (typeof record !== "object" || record === null) return false;
  // narrowed by typeof+null guard above — record is an untyped JSON object
  const obj = record as Record<string, unknown>;
  return filters.every((f) => String(obj[f.field]) === f.value);
};

/** Recursively strip fields from a plain object along dotted paths.
 *  Fields in `preserve` are never stripped (used to keep identity keys like `job_cluster_key`).
 *  e.g. stripping `["job_cluster_key", "new_cluster.num_workers"]` with preserve={"job_cluster_key"}
 *  removes only `new_cluster.num_workers` and keeps everything else including the identity key. */
const stripFieldsFromObject = (
  obj: Readonly<Record<string, unknown>>,
  fieldPaths: readonly string[],
  preserve: ReadonlySet<string> = new Set(),
): Readonly<Record<string, unknown>> => {
  const directRemove = new Set<string>();
  const nestedPaths = new Map<string, string[]>();

  for (const path of fieldPaths) {
    const dotIndex = path.indexOf(".");
    if (dotIndex === -1) {
      directRemove.add(path);
    } else {
      const key = path.slice(0, dotIndex);
      const rest = path.slice(dotIndex + 1);
      const existing = nestedPaths.get(key);
      if (existing !== undefined) {
        existing.push(rest);
      } else {
        nestedPaths.set(key, [rest]);
      }
    }
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (directRemove.has(key) && !preserve.has(key)) continue;
    const nested = nestedPaths.get(key);
    if (nested !== undefined && isUnknownRecord(value)) {
      result[key] = stripFieldsFromObject(value, nested, preserve);
    } else {
      result[key] = value;
    }
  }
  return result;
};

/** Parse a numeric array index from the start of a path like `[0].task_key`. */
const NUMERIC_INDEX_PATTERN = /^\[(\d+)\]/;

const parseNumericIndex = (path: string): number | undefined => {
  const match = NUMERIC_INDEX_PATTERN.exec(path);
  return match?.[1] !== undefined ? Number(match[1]) : undefined;
};

/** Extract the sub-path after a bracket selector (e.g. `[0].task_key` → `task_key`).
 *  Returns undefined if there is no sub-path (whole-element reference). */
const extractSubPath = (path: string): string | undefined => {
  const bracketEnd = path.indexOf("]");
  if (bracketEnd === -1) return undefined;
  const rest = path.slice(bracketEnd + 1);
  if (rest === "") return undefined;
  return rest.startsWith(".") ? rest.slice(1) : rest;
};

/** Resolve which array index a path targets: by numeric index or by named bracket filter. */
const resolveArrayIndex = (path: string, arr: readonly unknown[]): number | undefined => {
  const numericIndex = parseNumericIndex(path);
  if (numericIndex !== undefined) return numericIndex;

  const bracketEnd = path.indexOf("]");
  if (bracketEnd === -1) return undefined;
  const bracketSegment = path.slice(0, bracketEnd + 1);
  const filters = parseBracketFilters(bracketSegment);
  if (filters.length === 0) return undefined;

  return arr.findIndex((item) => matchesAllFilters(item, filters));
};

/** Strip changed fields from array elements, preserving unchanged fields.
 *  Paths with sub-fields (e.g. `[0].job_cluster_key`) strip only that field from the element.
 *  Paths without sub-fields (e.g. `[0]`) remove the whole element.
 *  Identity fields (e.g. `job_cluster_key`) are never stripped so elements remain identifiable. */
const stripChangedEntriesFromArray = (
  arr: readonly unknown[],
  relativePaths: readonly string[],
): readonly unknown[] => {
  const indicesToRemove = new Set<number>();
  const fieldPathsByIndex = new Map<number, string[]>();

  for (const path of relativePaths) {
    const index = resolveArrayIndex(path, arr);
    if (index === undefined || index === -1) continue;

    const subPath = extractSubPath(path);
    if (subPath === undefined) {
      indicesToRemove.add(index);
    } else {
      const existing = fieldPathsByIndex.get(index);
      if (existing !== undefined) {
        existing.push(subPath);
      } else {
        fieldPathsByIndex.set(index, [subPath]);
      }
    }
  }

  if (indicesToRemove.size === 0 && fieldPathsByIndex.size === 0) return arr;

  const identityKey = findIdentityKey(arr, arr);
  const preserve = identityKey !== undefined ? new Set([identityKey]) : new Set<string>();

  // Single pass: process each element by its original index before any filtering
  const result: unknown[] = [];
  for (let i = 0; i < arr.length; i++) {
    if (indicesToRemove.has(i)) continue;
    const element = arr[i];
    const fieldPaths = fieldPathsByIndex.get(i);
    if (fieldPaths !== undefined && isUnknownRecord(element)) {
      result.push(stripFieldsFromObject(element, fieldPaths, preserve));
    } else {
      result.push(element);
    }
  }
  return result;
};

/** Strip changed entries from a plain object's nested arrays via bracket paths.
 *  Groups paths by field name and delegates to the array handler. */
const stripChangedEntriesFromRecord = (
  record: Readonly<Record<string, unknown>>,
  relativePaths: readonly string[],
): Readonly<Record<string, unknown>> => {
  const pathsByField = new Map<string, string[]>();

  for (const path of relativePaths) {
    const bracketStart = path.indexOf("[");
    if (bracketStart === -1) continue;
    const fieldName = path.slice(0, bracketStart);
    const bracketPath = path.slice(bracketStart);
    const existing = pathsByField.get(fieldName);
    if (existing !== undefined) {
      existing.push(bracketPath);
    } else {
      pathsByField.set(fieldName, [bracketPath]);
    }
  }

  if (pathsByField.size === 0) return record;

  const result = { ...record };
  for (const [fieldName, paths] of pathsByField) {
    const arr = result[fieldName];
    if (!Array.isArray(arr)) continue;
    result[fieldName] = stripChangedEntriesFromArray(arr, paths);
  }

  return result;
};

/** Remove array entries referenced by bracket expressions in change paths.
 *  Handles both direct array values (paths start with `[N]` or `[field='value']`)
 *  and plain objects containing nested arrays (paths like `field[filter].rest`). */
export const stripChangedArrayEntries = (
  stateValue: unknown,
  relativePaths: readonly string[],
): unknown => {
  if (Array.isArray(stateValue)) {
    return stripChangedEntriesFromArray(stateValue, relativePaths);
  }

  if (isUnknownRecord(stateValue)) {
    return stripChangedEntriesFromRecord(stateValue, relativePaths);
  }

  return stateValue;
};
