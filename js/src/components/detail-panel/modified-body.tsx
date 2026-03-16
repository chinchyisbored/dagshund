import type { DagNodeData } from "../../types/graph-types.ts";
import type { ChangeDesc } from "../../types/plan-schema.ts";
import { ChangeEntry, stripTaskPrefix } from "./change-entry.tsx";
import { ResourceStateView } from "./resource-state-view.tsx";
import { SectionDivider } from "./section-divider.tsx";

/** Extract the top-level field name from a change path (e.g. `notebook_task.notebook_path` → `notebook_task`). */
const topLevelFieldName = (path: string): string => {
  const stripped = stripTaskPrefix(path);
  const dotIndex = stripped.indexOf(".");
  return dotIndex === -1 ? stripped : stripped.slice(0, dotIndex);
};

/** Extract the path relative to the top-level field name, or undefined for direct field changes. */
const extractRelativeChangePath = (path: string): string | undefined => {
  const stripped = stripTaskPrefix(path);
  const dotIndex = stripped.indexOf(".");
  return dotIndex === -1 ? undefined : stripped.slice(dotIndex + 1);
};

/** Parse bracket expressions like `[field='value']` from a path segment. */
const BRACKET_PATTERN = /\[(\w+)='([^']+)'\]/g;

const parseBracketFilters = (
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
const matchesAllFilters = (
  record: unknown,
  filters: readonly { readonly field: string; readonly value: string }[],
): boolean => {
  if (typeof record !== "object" || record === null) return false;
  // narrowed by typeof+null guard above — record is an untyped JSON object
  const obj = record as Record<string, unknown>;
  return filters.every((f) => String(obj[f.field]) === f.value);
};

/** Remove array entries referenced by bracket expressions in change paths.
 *  For a state value like `{ permissions: [{ group_name: 'users', ... }, { ... }] }` and a change
 *  path like `permissions[group_name='users'].permission_level`, removes the matching array entry. */
const stripChangedArrayEntries = (
  stateValue: unknown,
  relativePaths: readonly string[],
): unknown => {
  if (typeof stateValue !== "object" || stateValue === null || Array.isArray(stateValue)) {
    return stateValue;
  }

  // narrowed by typeof+null+isArray guards above — stateValue is a plain JSON object
  const record = stateValue as Record<string, unknown>;
  const result = { ...record };

  for (const path of relativePaths) {
    const dotIndex = path.indexOf(".");
    const firstSegment = dotIndex === -1 ? path : path.slice(0, dotIndex);
    const bracketStart = firstSegment.indexOf("[");
    if (bracketStart === -1) continue;

    const fieldName = firstSegment.slice(0, bracketStart);
    const filters = parseBracketFilters(firstSegment);
    if (filters.length === 0) continue;

    const arr = result[fieldName];
    if (!Array.isArray(arr)) continue;

    result[fieldName] = arr.filter((entry) => !matchesAllFilters(entry, filters));
  }

  return result;
};

/** Categorize changes by top-level field: direct (exact match) vs sub-field (dotted path). */
const categorizeChangedFields = (
  changes: readonly (readonly [string, ChangeDesc])[],
): {
  readonly exact: ReadonlySet<string>;
  readonly subFieldPaths: ReadonlyMap<string, readonly string[]>;
} => {
  const exact = new Set<string>();
  const subFieldPaths = new Map<string, string[]>();

  for (const [path] of changes) {
    const topLevel = topLevelFieldName(path);
    const relative = extractRelativeChangePath(path);
    if (relative === undefined) {
      exact.add(topLevel);
    } else {
      const existing = subFieldPaths.get(topLevel);
      if (existing !== undefined) {
        existing.push(relative);
      } else {
        subFieldPaths.set(topLevel, [relative]);
      }
    }
  }

  return { exact, subFieldPaths };
};

/** Filter resourceState: exclude direct-match changed fields,
 *  strip changed array entries from sub-field changed fields. */
const filterUnmodifiedState = (
  resourceState: Readonly<Record<string, unknown>>,
  exact: ReadonlySet<string>,
  subFieldPaths: ReadonlyMap<string, readonly string[]>,
): Readonly<Record<string, unknown>> => {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(resourceState)) {
    if (exact.has(key)) continue;

    const relativePaths = subFieldPaths.get(key);
    if (relativePaths !== undefined) {
      result[key] = stripChangedArrayEntries(value, relativePaths);
    } else {
      result[key] = value;
    }
  }

  return result;
};

const ADDED_ACTIONS: ReadonlySet<string> = new Set(["create"]);
const REMOVED_ACTIONS: ReadonlySet<string> = new Set(["delete"]);

type ChangeGroup = {
  readonly label: string;
  readonly entries: readonly (readonly [string, ChangeDesc])[];
};

/** Group meaningful changes into Added / Modified / Removed sections. */
const groupChangesByCategory = (
  changes: readonly (readonly [string, ChangeDesc])[],
): readonly ChangeGroup[] => {
  const added: (readonly [string, ChangeDesc])[] = [];
  const modified: (readonly [string, ChangeDesc])[] = [];
  const removed: (readonly [string, ChangeDesc])[] = [];

  for (const entry of changes) {
    const action = entry[1].action;
    if (ADDED_ACTIONS.has(action)) {
      added.push(entry);
    } else if (REMOVED_ACTIONS.has(action)) {
      removed.push(entry);
    } else {
      modified.push(entry);
    }
  }

  return [
    { label: "Added", entries: added },
    { label: "Modified", entries: modified },
    { label: "Removed", entries: removed },
  ].filter((group) => group.entries.length > 0);
};

export function ModifiedBody({
  data,
  meaningfulChanges,
}: {
  readonly data: DagNodeData;
  readonly meaningfulChanges: readonly (readonly [string, ChangeDesc])[];
}) {
  const changeGroups = groupChangesByCategory(meaningfulChanges);
  const { exact, subFieldPaths } = categorizeChangedFields(meaningfulChanges);
  const unmodifiedState = data.resourceState
    ? filterUnmodifiedState(data.resourceState, exact, subFieldPaths)
    : {};
  const hasUnmodifiedState = Object.keys(unmodifiedState).length > 0;

  return (
    <>
      {changeGroups.map((group) => (
        <div key={group.label}>
          <SectionDivider label={group.label} />
          <div className="flex flex-col gap-2">
            {group.entries.map(([fieldPath, change]) => (
              <ChangeEntry key={fieldPath} fieldPath={fieldPath} change={change} />
            ))}
          </div>
        </div>
      ))}
      {hasUnmodifiedState && (
        <>
          <SectionDivider label="Unchanged" />
          <ResourceStateView resourceState={unmodifiedState} />
        </>
      )}
    </>
  );
}
