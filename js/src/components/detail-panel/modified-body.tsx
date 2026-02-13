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

/** Collect the set of top-level field names that appear in meaningful changes. */
const collectChangedFieldNames = (
  changes: readonly (readonly [string, ChangeDesc])[],
): ReadonlySet<string> => new Set(changes.map(([path]) => topLevelFieldName(path)));

/** Filter resourceState to exclude keys whose top-level name appears in changes. */
const filterUnmodifiedState = (
  resourceState: Readonly<Record<string, unknown>>,
  changedFields: ReadonlySet<string>,
): Readonly<Record<string, unknown>> =>
  Object.fromEntries(Object.entries(resourceState).filter(([key]) => !changedFields.has(key)));

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
  const changedFields = collectChangedFieldNames(meaningfulChanges);
  const unmodifiedState = data.resourceState
    ? filterUnmodifiedState(data.resourceState, changedFields)
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
