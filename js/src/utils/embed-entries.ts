/**
 * __embed__ handling for the browser detail panel.
 *
 * `__embed__` is a Databricks CLI transport convention: an array of sub-resource
 * entries (permissions, grants) packed into a single state field.  It should
 * never appear as a raw field name in the UI.
 *
 * These utilities expand `__embed__` arrays into individual bracket-keyed entries
 * (e.g. `[principal='data_engineers']`) for display, with optional change-aware
 * filtering to exclude entries already shown in the Modified section.
 */

import { matchesAllFilters, parseBracketFilters, stripChangedFields } from "./change-path.ts";
import { findIdentityKey } from "./structural-diff.ts";
import { isUnknownRecord } from "./unknown-record.ts";

const EMBED_KEY = "__embed__";

// ---------------------------------------------------------------------------
// Identity resolution (per-entry)
// ---------------------------------------------------------------------------

/** Collect identity field names from bracket-filter change paths.
 *  e.g. `["[group_name='admins'].level", "[user_name='u1']"]` → `{"group_name", "user_name"}` */
const collectIdentityFieldsFromPaths = (
  embedChangePaths: readonly string[],
): ReadonlySet<string> => {
  const fields = new Set<string>();
  for (const path of embedChangePaths) {
    const bracketEnd = path.indexOf("]");
    if (bracketEnd === -1) continue;
    for (const { field } of parseBracketFilters(path.slice(0, bracketEnd + 1))) {
      fields.add(field);
    }
  }
  return fields;
};

/** String fields present on every entry — shared attributes, not identities.
 *  E.g. for permissions `[{level, group_name}, {level, user_name}]` → `{level}`.
 *  Returns empty for < 2 entries (concept only useful for disambiguation). */
const computeUniversalFields = (
  entries: readonly Readonly<Record<string, unknown>>[],
): ReadonlySet<string> => {
  if (entries.length < 2) return new Set();
  const first = entries[0];
  if (first === undefined) return new Set();
  const candidates = new Set<string>();
  for (const [key, value] of Object.entries(first)) {
    if (typeof value === "string") candidates.add(key);
  }
  for (let i = 1; i < entries.length; i++) {
    for (const key of candidates) {
      if (typeof entries[i]?.[key] !== "string") candidates.delete(key);
    }
  }
  return candidates;
};

/** Build a bracket-key label like `[field='value']` for a single embed entry.
 *
 *  Resolution order (per-entry, not per-array):
 *  1. First change-path identity field that exists on this entry
 *  2. Non-universal string field (entry-specific, not shared across all entries)
 *  3. Array-wide inferred identity from `findIdentityKey`
 *  4. First string-valued field on the entry
 *
 *  Step 2 distinguishes grants-style (uniform identity, only string field) from
 *  permissions-style (mixed identity fields + shared `level` attribute). */
const buildLabel = (
  entry: Readonly<Record<string, unknown>>,
  changePathFields: ReadonlySet<string>,
  inferredIdentity: string | undefined,
  universalFields: ReadonlySet<string>,
): string => {
  for (const field of changePathFields) {
    const value = entry[field];
    if (typeof value === "string") return `[${field}='${value}']`;
  }
  if (universalFields.size > 0) {
    for (const [key, value] of Object.entries(entry)) {
      if (typeof value === "string" && !universalFields.has(key)) return `[${key}='${value}']`;
    }
  }
  if (inferredIdentity !== undefined) {
    const value = entry[inferredIdentity];
    if (typeof value === "string") return `[${inferredIdentity}='${value}']`;
  }
  for (const [key, value] of Object.entries(entry)) {
    if (typeof value === "string") return `[${key}='${value}']`;
  }
  return "[?]";
};

// ---------------------------------------------------------------------------
// Change-path targeting
// ---------------------------------------------------------------------------

/** Check if an entry is targeted by any bracket-filter change path. */
const isTargetedByChangePaths = (
  entry: Readonly<Record<string, unknown>>,
  embedChangePaths: readonly string[],
): boolean => {
  for (const path of embedChangePaths) {
    const bracketEnd = path.indexOf("]");
    if (bracketEnd === -1) continue;
    const filters = parseBracketFilters(path.slice(0, bracketEnd + 1));
    if (filters.length > 0 && matchesAllFilters(entry, filters)) return true;
  }
  return false;
};

// ---------------------------------------------------------------------------
// Display expansion (no change awareness)
// ---------------------------------------------------------------------------

/** Recursively expand `__embed__` arrays into individual bracket-keyed entries.
 *  Handles both top-level and nested `__embed__` (merged sub-resource state).
 *  Returns the original record if no `__embed__` is found at any level. */
export const expandEmbedEntries = (
  state: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> => {
  let changed = false;
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(state)) {
    if (key === EMBED_KEY && Array.isArray(value)) {
      changed = true;
      const entries = value.filter(isUnknownRecord);
      const inferredIdentity = findIdentityKey(entries, []);
      const universalFields = computeUniversalFields(entries);
      const noChangeFields = new Set<string>();
      for (const entry of entries) {
        result[buildLabel(entry, noChangeFields, inferredIdentity, universalFields)] = entry;
      }
    } else if (isUnknownRecord(value)) {
      const expanded = expandEmbedEntries(value);
      if (expanded !== value) changed = true;
      result[key] = expanded;
    } else {
      result[key] = value;
    }
  }

  return changed ? result : state;
};

// ---------------------------------------------------------------------------
// Change-aware filtering (for filterUnmodifiedState)
// ---------------------------------------------------------------------------

/** Expand `__embed__` entries that are NOT targeted by any change path.
 *  Returns bracket-keyed entries for the unchanged portion only. */
export const filterUnchangedEmbedEntries = (
  embedArray: readonly unknown[],
  embedChangePaths: readonly string[],
): Readonly<Record<string, unknown>> => {
  const allEntries = embedArray.filter(isUnknownRecord);
  const unchangedEntries =
    embedChangePaths.length > 0
      ? allEntries.filter((entry) => !isTargetedByChangePaths(entry, embedChangePaths))
      : allEntries;

  const changePathFields = collectIdentityFieldsFromPaths(embedChangePaths);
  const universalFields = computeUniversalFields(allEntries);
  const inferredIdentity = findIdentityKey(allEntries, []);
  const result: Record<string, unknown> = {};

  for (const entry of unchangedEntries) {
    result[buildLabel(entry, changePathFields, inferredIdentity, universalFields)] = entry;
  }

  return result;
};

/** Strip fields from a record that may contain `__embed__`, routing bracket-filter
 *  change paths to the embed array instead of the generic record-stripping logic.
 *
 *  Bracket-filter paths (starting with `[`) target embed entries.
 *  Regular paths go through `stripChangedFields` as normal.
 *  The `__embed__` key is replaced by expanded unchanged entries.
 *
 *  Falls through to `stripChangedFields` when no bracket-filter paths exist. */
export const stripEmbedFromRecord = (
  record: Readonly<Record<string, unknown>>,
  relativePaths: readonly string[],
): unknown => {
  const regularPaths: string[] = [];
  const embedPaths: string[] = [];

  for (const path of relativePaths) {
    if (path.startsWith("[")) {
      embedPaths.push(path);
    } else {
      regularPaths.push(path);
    }
  }

  if (embedPaths.length === 0) {
    return stripChangedFields(record, relativePaths);
  }

  const stripped =
    regularPaths.length > 0
      ? (stripChangedFields(record, regularPaths) as Readonly<Record<string, unknown>>)
      : record;

  const embedArray = record[EMBED_KEY];
  if (!Array.isArray(embedArray)) return stripped;

  const expanded = filterUnchangedEmbedEntries(embedArray, embedPaths);
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(stripped)) {
    if (key !== EMBED_KEY) result[key] = value;
  }
  Object.assign(result, expanded);

  return result;
};
