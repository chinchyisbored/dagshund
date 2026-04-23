import type { DagNodeData } from "../../types/graph-types.ts";
import type { ChangeDesc } from "../../types/plan-schema.ts";
import {
  extractRelativeChangePath,
  isEmptyValue,
  stripChangedFields,
  topLevelFieldName,
} from "../../utils/change-path.ts";
import { filterUnchangedEmbedEntries, stripEmbedFromRecord } from "../../utils/embed-entries.ts";
import { deriveFieldAction, type FieldChangeContext } from "../../utils/field-action.ts";
import { isUnknownRecord } from "../../utils/unknown-record.ts";
import { ChangeEntry } from "./change-entry.tsx";
import { ResourceStateView } from "./resource-state-view.tsx";
import { SectionDivider } from "./section-divider.tsx";

/** Categorize change paths by top-level field: direct (exact match) vs sub-field (dotted path). */
const categorizeChangedFields = (
  paths: readonly string[],
): {
  readonly exact: ReadonlySet<string>;
  readonly subFieldPaths: ReadonlyMap<string, readonly string[]>;
} => {
  const exact = new Set<string>();
  const subFieldPaths = new Map<string, string[]>();

  for (const path of paths) {
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

/** Check whether any path in the list starts with a bracket-filter (not dict-key). */
const hasBracketFilterPaths = (paths: readonly string[]): boolean =>
  paths.some((p) => p.startsWith("["));

/** Filter resourceState: exclude direct-match changed fields,
 *  strip changed array entries from sub-field changed fields,
 *  and expand __embed__ arrays into bracket-keyed entries. */
const filterUnmodifiedState = (
  resourceState: Readonly<Record<string, unknown>>,
  exact: ReadonlySet<string>,
  subFieldPaths: ReadonlyMap<string, readonly string[]>,
): Readonly<Record<string, unknown>> => {
  // Orphan sub-resources: bracket-filter paths land under "" (empty topLevelFieldName)
  const embedChangePaths = subFieldPaths.get("") ?? [];
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(resourceState)) {
    if (exact.has(key)) continue;

    // Orphan case: top-level __embed__ with bracket-filter paths under ""
    if (key === "__embed__" && Array.isArray(value)) {
      const expanded = filterUnchangedEmbedEntries(value, embedChangePaths);
      Object.assign(result, expanded);
      continue;
    }

    const relativePaths = subFieldPaths.get(key);
    if (relativePaths !== undefined) {
      // Merged case: sub-resource record containing __embed__ with bracket-filter paths
      const stripped =
        hasBracketFilterPaths(relativePaths) && isUnknownRecord(value)
          ? stripEmbedFromRecord(value, relativePaths)
          : stripChangedFields(value, relativePaths);
      if (!isEmptyValue(stripped)) result[key] = stripped;
    } else {
      result[key] = value;
    }
  }

  return result;
};

type ChangeEntryWithCtx = {
  readonly fieldPath: string;
  readonly change: ChangeDesc;
  readonly ctx: FieldChangeContext;
};

type ChangeGroup = {
  readonly label: string;
  readonly entries: readonly ChangeEntryWithCtx[];
};

/** Group meaningful changes into Added / Modified / Removed / Remote-only sections.
 *
 *  Groups by the shape-derived action (same source of truth as the per-entry
 *  `ActionBadge`) so the section header and the badge agree. Before this fix
 *  the header grouped on raw `change.action` while the badge used
 *  `deriveFieldAction` — the CLI's per-field `action: "update"` pushed every
 *  derived create/delete/remote entry into "Modified" (dagshund-1naj).
 */
const groupChangesByCategory = (entries: readonly ChangeEntryWithCtx[]): readonly ChangeGroup[] => {
  const added: ChangeEntryWithCtx[] = [];
  const modified: ChangeEntryWithCtx[] = [];
  const removed: ChangeEntryWithCtx[] = [];
  const remoteOnly: ChangeEntryWithCtx[] = [];

  for (const entry of entries) {
    const action = deriveFieldAction(entry.change, entry.ctx);
    if (action === "create") added.push(entry);
    else if (action === "delete") removed.push(entry);
    else if (action === "remote") remoteOnly.push(entry);
    else modified.push(entry);
  }

  return [
    { label: "Added", entries: added },
    { label: "Modified", entries: modified },
    { label: "Removed", entries: removed },
    { label: "Remote-only (not managed by bundle)", entries: remoteOnly },
  ].filter((group) => group.entries.length > 0);
};

export function ModifiedBody({
  data,
  fieldChanges,
  excludePaths,
}: {
  readonly data: DagNodeData;
  readonly fieldChanges: readonly (readonly [string, ChangeDesc])[];
  /** Paths to strip from the Unchanged section. When omitted, defaults to the
   *  keys of `fieldChanges` (historical behavior). Callers that also render
   *  drift entries elsewhere pass a merged list so those paths don't double up
   *  in Unchanged (dagshund-93lv). */
  readonly excludePaths?: readonly string[];
}) {
  // `data.resourceHasShapeDrift` is computed at graph-build time over the full
  // enclosing plan entry (see BaseGraphNode), so task nodes correctly inherit
  // their parent job's drift state. A local recompute over `fieldChanges`
  // would miss job-level drift signals when rendering a task panel.
  const entriesWithCtx: readonly ChangeEntryWithCtx[] = fieldChanges.map(([fieldPath, change]) => ({
    fieldPath,
    change,
    ctx: {
      changeKey: fieldPath,
      newState: data.newState,
      remoteState: data.remoteState,
      resourceHasShapeDrift: data.resourceHasShapeDrift,
    },
  }));
  const changeGroups = groupChangesByCategory(entriesWithCtx);
  const stripPaths = excludePaths ?? fieldChanges.map(([path]) => path);
  const { exact, subFieldPaths } = categorizeChangedFields(stripPaths);
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
            {group.entries.map(({ fieldPath, change, ctx }) => (
              <ChangeEntry key={fieldPath} fieldPath={fieldPath} change={change} ctx={ctx} />
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
