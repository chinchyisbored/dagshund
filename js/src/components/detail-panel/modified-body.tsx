import type { DagNodeData } from "../../types/graph-types.ts";
import type { ChangeDesc } from "../../types/plan-schema.ts";
import {
  extractRelativeChangePath,
  isEmptyValue,
  stripChangedFields,
  topLevelFieldName,
} from "../../utils/change-path.ts";
import { ChangeEntry } from "./change-entry.tsx";
import { ResourceStateView } from "./resource-state-view.tsx";
import { SectionDivider } from "./section-divider.tsx";

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
      const stripped = stripChangedFields(value, relativePaths);
      if (!isEmptyValue(stripped)) result[key] = stripped;
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
  fieldChanges,
}: {
  readonly data: DagNodeData;
  readonly fieldChanges: readonly (readonly [string, ChangeDesc])[];
}) {
  const changeGroups = groupChangesByCategory(fieldChanges);
  const { exact, subFieldPaths } = categorizeChangedFields(fieldChanges);
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
