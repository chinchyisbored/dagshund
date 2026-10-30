import type { PlanEntry } from "../types/plan-schema.ts";
import type { PreparationDiagnostic, Projection } from "../types/prepared-plan.ts";
import { selectEffectiveResourceState } from "../utils/effective-resource-state.ts";
import { extractResourceType } from "../utils/resource-key.ts";
import { isUnknownRecord } from "../utils/unknown-record.ts";

type ConfiguredInputs = Readonly<{
  readonly sourceTableFullName: Projection<string>;
  readonly postgres: Projection<Readonly<Record<string, string>>>;
  readonly diagnostics: readonly PreparationDiagnostic[];
}>;

const absent = { status: "absent" } as const;

const areEqualJsonValues = (left: unknown, right: unknown): boolean => {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => areEqualJsonValues(value, right[index]))
    );
  }
  if (!isUnknownRecord(left) || !isUnknownRecord(right)) return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every((key) => Object.hasOwn(right, key) && areEqualJsonValues(left[key], right[key]))
  );
};

/** Recover only unchanged configured references omitted from skipped Postgres sync snapshots. */
export const preparePostgresSyncedTableInputs = (
  resourceKey: string,
  entry: PlanEntry,
): ConfiguredInputs => {
  if (
    extractResourceType(resourceKey) !== "postgres_synced_tables" ||
    entry.action !== "skip" ||
    entry.new_state !== undefined ||
    selectEffectiveResourceState(entry).origin !== "remote" ||
    !isUnknownRecord(entry.remote_state) ||
    Object.keys(entry.remote_state).length === 0
  ) {
    return { sourceTableFullName: absent, postgres: absent, diagnostics: [] };
  }

  const sourceValues: Record<string, string> = {};
  const postgresValues: Record<string, string> = {};
  const diagnostics: PreparationDiagnostic[] = [];
  let malformedSource = false;
  let malformedPostgres = false;
  for (const [field, target] of [
    ["source_table_full_name", sourceValues],
    ["branch", postgresValues],
    ["postgres_database", postgresValues],
  ] as const) {
    const change = entry.changes?.[field];
    if (
      change === undefined ||
      change.action !== "skip" ||
      change.reason !== "spec:input_only" ||
      change.old === undefined ||
      change.new === undefined ||
      !areEqualJsonValues(change.old, change.new)
    ) {
      continue;
    }
    if (typeof change.old !== "string" || change.old === "") {
      if (field === "source_table_full_name") malformedSource = true;
      else malformedPostgres = true;
      continue;
    }
    target[field] = change.old;
  }

  const diagnostic: PreparationDiagnostic = {
    resourceKey,
    capability: "postgres-synced-table-configured-inputs",
    reason: "invalid-shape",
  };
  if (malformedSource || malformedPostgres) diagnostics.push(diagnostic);
  const sourceTableFullName: Projection<string> = malformedSource
    ? { status: "unsupported", diagnostic }
    : sourceValues["source_table_full_name"] === undefined
      ? absent
      : { status: "supported", value: sourceValues["source_table_full_name"] };
  const postgres: Projection<Readonly<Record<string, string>>> = malformedPostgres
    ? { status: "unsupported", diagnostic }
    : Object.keys(postgresValues).length === 0
      ? absent
      : { status: "supported", value: postgresValues };
  return { sourceTableFullName, postgres, diagnostics };
};
