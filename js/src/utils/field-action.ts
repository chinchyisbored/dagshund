import type { ActionType, ChangeDesc } from "../types/plan-schema.ts";
import { matchesAllFilters, parseBracketFilters } from "./change-path.ts";
import { isUnknownRecord } from "./unknown-record.ts";

/** Actions that treat sub-field changes as part of an update — mirrors
 *  ACTIONS[...].show_field_changes == True in src/dagshund/format.py. */
const FIELD_CHANGE_ACTIONS: ReadonlySet<ActionType> = new Set([
  "update",
  "update_id",
  "recreate",
  "resize",
]);

export type ListElementSemantic = "create" | "delete" | "update";

/** Context passed alongside a `ChangeDesc` when the caller has the parent state.
 *
 *  Mirrors Python's `FieldChangeContext` in `src/dagshund/change_path.py` and
 *  shares test vectors at `fixtures/list-element-semantic-cases.json` to guard
 *  against language drift. See that file's frontmatter for the rationale behind
 *  `resourceHasShapeDrift` gating list-element-delete drift reclassification.
 *  (dagshund-1naj)
 */
export type FieldChangeContext = {
  readonly changeKey: string;
  readonly newState: unknown;
  readonly remoteState: unknown;
  readonly resourceHasShapeDrift: boolean;
};

/** Trailing chain of `[field='value']` bracket filters — requires `=` inside
 *  brackets (distinguishes list-element filters from dict-key brackets like
 *  `properties['environment']`). */
const TRAILING_LIST_FILTER_PATTERN = /((?:\[[A-Za-z_][A-Za-z0-9_]*='[^']*'\])+)$/;

/** Segment parser: optional identifier prefix + optional bracket filters. */
const SEGMENT_PATTERN = /^([A-Za-z_][A-Za-z0-9_]*)?((?:\[[^[\]]+\])*)$/;

const MISSING = Symbol("missing");
type Resolved = unknown | typeof MISSING;

/** Classify a per-element list change by consulting parent state trees.
 *
 *  Returns `undefined` when the change key does not end in a list-element
 *  bracket-filter (plain fields, dict-key brackets), when the trees are
 *  missing at the parent path, or when the element content is identical
 *  on both sides (noop — let upstream filters drop it).
 */
export const extractListElementSemantic = (
  ctx: FieldChangeContext,
): ListElementSemantic | undefined => {
  const trailingMatch = TRAILING_LIST_FILTER_PATTERN.exec(ctx.changeKey);
  if (trailingMatch === null || trailingMatch[1] === undefined) return undefined;

  const filters = parseBracketFilters(trailingMatch[1]);
  if (filters.length === 0) return undefined;
  const parentPath = ctx.changeKey.slice(0, trailingMatch.index).replace(/\.$/, "");

  const newElem = resolveListElement(unwrapNewState(ctx.newState), parentPath, filters);
  const remoteElem = resolveListElement(unwrapRemoteState(ctx.remoteState), parentPath, filters);

  const inNew = newElem !== MISSING;
  const inRemote = remoteElem !== MISSING;

  if (inRemote && !inNew) return "delete";
  if (inNew && !inRemote) return "create";
  if (inNew && inRemote) return deepEqualRec(newElem, remoteElem) ? undefined : "update";
  return undefined;
};

/** `new_state` is wrapped as `{value: {...}, vars: {...}}` by the CLI. */
const unwrapNewState = (state: unknown): Readonly<Record<string, unknown>> | undefined => {
  if (!isUnknownRecord(state)) return undefined;
  const inner = state["value"];
  return isUnknownRecord(inner) ? inner : state;
};

/** `remote_state` is the bare state dict (no wrapper). */
const unwrapRemoteState = (state: unknown): Readonly<Record<string, unknown>> | undefined =>
  isUnknownRecord(state) ? state : undefined;

const resolveListElement = (
  root: Readonly<Record<string, unknown>> | undefined,
  parentPath: string,
  filters: readonly { readonly field: string; readonly value: string }[],
): Resolved => {
  if (root === undefined) return MISSING;

  let current: unknown = root;
  for (const segment of splitSegments(parentPath)) {
    current = resolveSegment(current, segment);
    if (current === undefined) return MISSING;
  }

  if (!Array.isArray(current)) return MISSING;
  const match = current.find((item) => matchesAllFilters(item, filters));
  return match ?? MISSING;
};

/** Split `path` on `.` while respecting brackets (values may contain `.`). */
const splitSegments = (path: string): string[] => {
  if (path === "") return [];
  const segments: string[] = [];
  let buf = "";
  let depth = 0;
  for (const ch of path) {
    if (ch === "[") {
      depth++;
      buf += ch;
    } else if (ch === "]") {
      depth--;
      buf += ch;
    } else if (ch === "." && depth === 0) {
      if (buf !== "") {
        segments.push(buf);
        buf = "";
      }
    } else {
      buf += ch;
    }
  }
  if (buf !== "") segments.push(buf);
  return segments;
};

const resolveSegment = (current: unknown, segment: string): unknown => {
  const match = SEGMENT_PATTERN.exec(segment);
  if (match === null) return undefined;
  const prefix = match[1];
  const brackets = match[2];

  let next = current;
  if (prefix !== undefined && prefix !== "") {
    if (!isUnknownRecord(next)) return undefined;
    next = next[prefix];
  }

  if (brackets !== undefined && brackets !== "") {
    if (!Array.isArray(next)) return undefined;
    const filters = parseBracketFilters(brackets);
    next = next.find((item) => matchesAllFilters(item, filters));
  }

  return next;
};

/** Local deep-equal (avoids importing from structural-diff.ts to keep this module standalone). */
const deepEqualRec = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, i) => deepEqualRec(item, b[i]));
  }
  if (isUnknownRecord(a) && isUnknownRecord(b)) {
    const aKeys = Object.keys(a);
    if (aKeys.length !== Object.keys(b).length) return false;
    return aKeys.every((key) => key in b && deepEqualRec(a[key], b[key]));
  }
  return false;
};

/**
 * Derive the display action for a field-level change.
 *
 * The Databricks CLI reports "update" for every field inside an updated
 * resource even when the field itself is new, removed, or remote-only. This
 * mirrors `field_action_config` in `src/dagshund/format.py` so the browser
 * badge matches the CLI's per-field symbol/label.
 *
 * When `ctx` is provided, per-element list paths (ending in `[field='value']`)
 * consult the parent state to disambiguate shapes that are structurally
 * identical to unrelated semantics — e.g. a list element present only on the
 * remote reads like a remote-only field but is actually a delete. Falls back
 * to shape-based derivation for non-list-element paths and for callers without
 * parent state.
 */
export const deriveFieldAction = (change: ChangeDesc, ctx?: FieldChangeContext): string => {
  // Only update-family actions get overrides — create/delete/skip/unknown are
  // resource-level and already correct.
  if (!FIELD_CHANGE_ACTIONS.has(change.action)) {
    return change.action;
  }

  if (ctx !== undefined) {
    const semantic = extractListElementSemantic(ctx);
    // ListElementSemantic values are exact ActionType strings — return directly.
    if (semantic !== undefined) return semantic;
  }

  const hasOld = "old" in change;
  const hasNew = "new" in change;
  const hasRemote = "remote" in change;

  if (hasNew && !hasOld) return "create";
  if (hasOld && !hasNew) return "delete";
  if (!hasOld && !hasNew && hasRemote) return "remote";
  return change.action;
};
