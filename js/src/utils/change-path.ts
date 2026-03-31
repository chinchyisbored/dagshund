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

/** Parse a dict-key bracket like `['sample_size']` at the start of a path.
 *  Returns the key and the remaining path after `]`, or undefined if not a dict-key bracket.
 *  Does not match numeric indices (`[0]`) or named filters (`[field='value']`). */
const DICT_KEY_PATTERN = /^\['([^']+)'\]/;

export const parseDictKeyBracket = (
  path: string,
): { readonly key: string; readonly rest: string } | undefined => {
  const match = DICT_KEY_PATTERN.exec(path);
  if (match?.[1] === undefined) return undefined;
  const rest = path.slice(match[0].length);
  return { key: match[1], rest: rest.startsWith(".") ? rest.slice(1) : rest };
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

/** Check if a stripped value is empty (no remaining content worth showing). */
export const isEmptyValue = (value: unknown): boolean => {
  if (isUnknownRecord(value)) return Object.keys(value).length === 0;
  if (Array.isArray(value)) return value.length === 0;
  return false;
};

/** Strip changed fields from array elements.
 *  Paths with sub-fields (e.g. `[0].job_cluster_key`) strip that field from the element
 *  by delegating to the dispatcher for full dot/bracket/dict-key support.
 *  Paths without sub-fields (e.g. `[0]`) remove the whole element.
 *  Elements that become empty after stripping are also removed. */
const stripChangedEntriesFromArray = (
  arr: readonly unknown[],
  relativePaths: readonly string[],
): readonly unknown[] => {
  const indicesToRemove = new Set<number>();
  const subPathsByIndex = new Map<number, string[]>();

  for (const path of relativePaths) {
    const index = resolveArrayIndex(path, arr);
    if (index === undefined || index === -1) continue;

    const subPath = extractSubPath(path);
    if (subPath === undefined) {
      indicesToRemove.add(index);
    } else {
      const existing = subPathsByIndex.get(index);
      if (existing !== undefined) {
        existing.push(subPath);
      } else {
        subPathsByIndex.set(index, [subPath]);
      }
    }
  }

  if (indicesToRemove.size === 0 && subPathsByIndex.size === 0) return arr;

  const result: unknown[] = [];
  for (let i = 0; i < arr.length; i++) {
    if (indicesToRemove.has(i)) continue;
    const element = arr[i];
    const subPaths = subPathsByIndex.get(i);
    if (subPaths !== undefined) {
      const stripped = stripChangedFields(element, subPaths);
      if (!isEmptyValue(stripped)) result.push(stripped);
    } else {
      result.push(element);
    }
  }
  return result;
};

/** Strip changed entries from a plain object by traversing nested paths.
 *  Splits each path at the first delimiter (dot or bracket), groups by the first key segment,
 *  and recurses via stripChangedFields to handle both nested objects and arrays.
 *  Dict-key brackets at position 0 (e.g. `['key']`) are parsed as direct field access. */
const stripChangedEntriesFromRecord = (
  record: Readonly<Record<string, unknown>>,
  relativePaths: readonly string[],
): Readonly<Record<string, unknown>> => {
  const directRemove = new Set<string>();
  const pathsByField = new Map<string, string[]>();

  for (const path of relativePaths) {
    const dotIndex = path.indexOf(".");
    const bracketIndex = path.indexOf("[");
    const splitAt = earliestIndex(dotIndex, bracketIndex);

    if (splitAt === -1) {
      directRemove.add(path);
      continue;
    }

    let fieldName: string;
    let remaining: string;

    if (splitAt === 0) {
      // Bracket at position 0 — try dict-key bracket (e.g. ['sample_size'])
      const dictKey = parseDictKeyBracket(path);
      if (dictKey === undefined) continue; // Unrecognized bracket syntax — skip
      fieldName = dictKey.key;
      remaining = dictKey.rest;
    } else {
      fieldName = path.slice(0, splitAt);
      remaining = path[splitAt] === "." ? path.slice(splitAt + 1) : path.slice(splitAt);
    }

    if (remaining === "") {
      directRemove.add(fieldName);
      continue;
    }

    const existing = pathsByField.get(fieldName);
    if (existing !== undefined) {
      existing.push(remaining);
    } else {
      pathsByField.set(fieldName, [remaining]);
    }
  }

  if (directRemove.size === 0 && pathsByField.size === 0) return record;

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (directRemove.has(key)) continue;
    const nested = pathsByField.get(key);
    if (nested !== undefined) {
      const stripped = stripChangedFields(value, nested);
      if (!isEmptyValue(stripped)) result[key] = stripped;
    } else {
      result[key] = value;
    }
  }

  return result;
};

/** Strip changed entries from a value by dispatching to the appropriate handler.
 *  Arrays: strip/remove elements via bracket paths.
 *  Records: traverse nested objects/arrays via dot and bracket paths.
 *  Primitives: returned unchanged. */
export const stripChangedFields = (
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
