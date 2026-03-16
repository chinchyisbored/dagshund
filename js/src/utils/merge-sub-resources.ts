import type { ChangeDesc, PlanEntry } from "../types/plan-schema.ts";
import {
  extractParentResourceKey,
  extractSubResourceSuffix,
  isSubResourceKey,
} from "./resource-key.ts";

/** Prefix each change key with `suffix.` so merged changes are namespaced. */
const prefixChanges = (
  suffix: string,
  changes: Readonly<Record<string, ChangeDesc>> | undefined,
): Readonly<Record<string, ChangeDesc>> | undefined => {
  if (changes === undefined) return undefined;
  const entries = Object.entries(changes);
  if (entries.length === 0) return undefined;
  return Object.fromEntries(entries.map(([key, value]) => [`${suffix}.${key}`, value]));
};

/** Extract the inner value from a state wrapper (handles `{ value: ... }` and bare objects). */
const extractStateValue = (state: unknown): Record<string, unknown> | undefined => {
  if (typeof state !== "object" || state === null) return undefined;
  // narrowed by typeof+null guard above — plan state objects are untyped JSON
  const record = state as Record<string, unknown>;
  if (!("value" in state)) return undefined;
  const inner = record["value"];
  // narrowed by null+typeof guard — inner value is an untyped JSON object
  if (inner !== null && typeof inner === "object") return inner as Record<string, unknown>;
  return undefined;
};

/** Extract the bare state object (for remote_state which has no { value } wrapper). */
const extractBareState = (state: unknown): Record<string, unknown> | undefined => {
  if (typeof state !== "object" || state === null) return undefined;
  // narrowed by typeof+null guard above — remote_state is an untyped JSON object
  return state as Record<string, unknown>;
};

/** Resolve the best available state from a sub-resource: prefer new_state.value, fall back to remote_state. */
const resolveSubState = (subEntry: PlanEntry): Record<string, unknown> | undefined =>
  extractStateValue(subEntry.new_state) ?? extractBareState(subEntry.remote_state);

/** Inject sub-resource state under `suffix` key in parent's state. */
const injectState = (
  parentEntry: PlanEntry,
  suffix: string,
  subEntry: PlanEntry,
): Pick<PlanEntry, "new_state" | "remote_state"> => {
  const result: { new_state?: unknown; remote_state?: unknown } = {};
  const subState = resolveSubState(subEntry);

  // Inject into new_state.value — requires BOTH parent and sub to have state,
  // because new_state uses the { value: ..., vars: ... } wrapper that we can't fabricate.
  // remote_state below is more lenient: it's a bare object, so we can create one from scratch.
  const parentNewValue = extractStateValue(parentEntry.new_state);
  if (parentNewValue !== undefined && subState !== undefined) {
    result.new_state = {
      // extractStateValue succeeded, so new_state is a { value: ... } wrapper — safe to spread
      ...(parentEntry.new_state as Record<string, unknown>),
      value: { ...parentNewValue, [suffix]: subState },
    };
  } else {
    result.new_state = parentEntry.new_state;
  }

  // Inject into remote_state — create or extend as needed
  const parentRemote = parentEntry.remote_state;
  if (subState !== undefined) {
    const base =
      typeof parentRemote === "object" && parentRemote !== null
        ? (parentRemote as Record<string, unknown>) // narrowed by typeof+null guard
        : {};
    result.remote_state = { ...base, [suffix]: subState };
  } else {
    result.remote_state = parentEntry.remote_state;
  }

  return result;
};

/** Merge external depends_on from sub into parent, dropping self-referential entries
 *  and rewriting sub-resource-key targets to their parent key. */
const mergeExternalDeps = (
  parentDeps: PlanEntry["depends_on"],
  subDeps: PlanEntry["depends_on"],
  parentKey: string,
): PlanEntry["depends_on"] => {
  if (subDeps === undefined || subDeps.length === 0) return parentDeps;
  const external = subDeps
    .filter((dep) => dep.node !== parentKey)
    .map((dep) =>
      isSubResourceKey(dep.node) ? { ...dep, node: extractParentResourceKey(dep.node) } : dep,
    );
  if (external.length === 0) return parentDeps;
  return [...(parentDeps ?? []), ...external];
};

/** Promote parent action if it's skip/empty and sub has a real action. */
const promoteAction = (
  parentAction: PlanEntry["action"],
  subAction: PlanEntry["action"],
): PlanEntry["action"] => {
  const isParentInactive =
    parentAction === undefined || parentAction === "skip" || parentAction === "";
  const isSubActive = subAction !== undefined && subAction !== "skip" && subAction !== "";
  return isParentInactive && isSubActive ? "update" : parentAction;
};

/** Synthesize a whole-field change for a sub-resource with a destructive/constructive action but no field-level changes.
 *  E.g. a permissions sub with action "delete" becomes `{ permissions: { action: "delete", old: ... } }`. */
const synthesizeWholeFieldChange = (
  suffix: string,
  subEntry: PlanEntry,
): Readonly<Record<string, ChangeDesc>> | undefined => {
  const action = subEntry.action;
  if (action === undefined || action === "skip" || action === "") return undefined;
  if (subEntry.changes !== undefined && Object.keys(subEntry.changes).length > 0) return undefined;

  const subState = resolveSubState(subEntry);
  const change: Record<string, unknown> = { action };
  if (action === "delete" && subState !== undefined) change["old"] = subState;
  if (action === "create" && subState !== undefined) change["new"] = subState;
  // change has { action } plus optional old/new — matches ChangeDesc shape
  return { [suffix]: change as ChangeDesc };
};

/** Merge a single sub-resource into its parent entry. */
const mergeSingleSub = (
  parentEntry: PlanEntry,
  suffix: string,
  subEntry: PlanEntry,
  parentKey: string,
): PlanEntry => {
  const prefixed =
    prefixChanges(suffix, subEntry.changes) ?? synthesizeWholeFieldChange(suffix, subEntry);
  const mergedChanges =
    prefixed !== undefined || parentEntry.changes !== undefined
      ? { ...(parentEntry.changes ?? {}), ...(prefixed ?? {}) }
      : undefined;

  const stateUpdate = injectState(parentEntry, suffix, subEntry);
  const mergedDeps = mergeExternalDeps(parentEntry.depends_on, subEntry.depends_on, parentKey);

  return {
    ...parentEntry,
    action: promoteAction(parentEntry.action, subEntry.action),
    changes: mergedChanges,
    ...stateUpdate,
    depends_on: mergedDeps,
  };
};

/** Merge sub-resources into their parent entries.
 *  Sub-resource keys (>3 dot-segments) are absorbed into the parent;
 *  orphans (parent not in plan) are kept as standalone entries. */
export const mergeSubResources = (
  entries: Readonly<Record<string, PlanEntry>>,
): Record<string, PlanEntry> => {
  const parents: Record<string, PlanEntry> = {};
  const subsByParent = new Map<string, [string, PlanEntry][]>();

  for (const [key, entry] of Object.entries(entries)) {
    if (isSubResourceKey(key)) {
      const parentKey = extractParentResourceKey(key);
      const group = subsByParent.get(parentKey);
      if (group !== undefined) {
        group.push([key, entry]);
      } else {
        subsByParent.set(parentKey, [[key, entry]]);
      }
    } else {
      parents[key] = entry;
    }
  }

  // Fold each group of sub-resources into its parent
  for (const [parentKey, subs] of subsByParent) {
    const parentEntry = parents[parentKey];
    if (parentEntry !== undefined) {
      parents[parentKey] = subs.reduce<PlanEntry>((parent, [subKey, subEntry]) => {
        const suffix = extractSubResourceSuffix(subKey);
        return mergeSingleSub(parent, suffix, subEntry, parentKey);
      }, parentEntry);
    } else {
      // Orphan: parent not in plan — keep sub-resources as standalone
      for (const [subKey, subEntry] of subs) {
        parents[subKey] = subEntry;
      }
    }
  }

  return parents;
};
