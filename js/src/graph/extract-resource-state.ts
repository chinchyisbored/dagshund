import { z } from "zod/v4";
import type { PlanEntry } from "../types/plan-schema.ts";
import { selectEffectiveResourceState } from "../utils/effective-resource-state.ts";
import { getUnknownProp } from "../utils/unknown-record.ts";

// ---------------------------------------------------------------------------
// Zod schemas (parse boundary only)
// ---------------------------------------------------------------------------

/** Schema for remote_state: { ...fields } — generic (no field validation). */
const resourceRemoteStateSchema = z.record(z.string(), z.unknown()).readonly();

// ---------------------------------------------------------------------------
// State extraction helpers
// ---------------------------------------------------------------------------

/**
 * Safely extract a named field from a plan entry's state.
 * Extract a string field from only the selected current snapshot.
 */
export const extractStateField = (entry: PlanEntry, field: string): string | undefined => {
  const selected = selectEffectiveResourceState(entry);
  const parsed = resourceRemoteStateSchema.safeParse(selected.snapshot);
  if (!parsed.success) return undefined;
  const fieldValue = parsed.data[field];
  return typeof fieldValue === "string" ? fieldValue : undefined;
};

/** Extract an API identity field from either snapshot for explicit historical indexing. */
export const extractHistoricalStateField = (
  entry: PlanEntry,
  field: string,
): string | undefined => {
  const snapshots = [getUnknownProp(entry.new_state, "value"), entry.remote_state];
  for (const snapshot of snapshots) {
    const parsed = resourceRemoteStateSchema.safeParse(snapshot);
    if (!parsed.success) continue;
    const value = parsed.data[field];
    if (typeof value === "string") return value;
  }
  return undefined;
};

/** Extract the selected flat state object when it is a record. */
export const extractResourceState = (
  entry: PlanEntry,
): Readonly<Record<string, unknown>> | undefined => {
  const selected = selectEffectiveResourceState(entry);
  const parsed = resourceRemoteStateSchema.safeParse(selected.snapshot);
  return parsed.success ? parsed.data : undefined;
};

const extractExistingPipelineIdFromState = (state: unknown): string | undefined => {
  const candidates = [
    getUnknownProp(state, "existing_pipeline_id"),
    getUnknownProp(getUnknownProp(state, "spec"), "existing_pipeline_id"),
  ];
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const normalized = candidate.trim();
    if (normalized !== "") return normalized;
  }
  return undefined;
};

/** Extract an existing pipeline reference from the selected current snapshot. */
export const extractExistingPipelineId = (entry: PlanEntry): string | undefined =>
  extractExistingPipelineIdFromState(selectEffectiveResourceState(entry).snapshot);

/** Extract top-level or spec.source_table_full_name from a synced table entry's state. */
export const extractSourceTableFullName = (entry: PlanEntry): string | undefined => {
  const state = extractResourceState(entry);
  if (state === undefined) return undefined;
  const topLevelName = state["source_table_full_name"];
  if (typeof topLevelName === "string") return topLevelName;
  const name = getUnknownProp(state["spec"], "source_table_full_name");
  return typeof name === "string" ? name : undefined;
};

/** Parse a three-part UC name ("catalog.schema.table") into components.
 *  Returns undefined if the name doesn't have exactly three dot-separated parts. */
export const parseThreePartName = (
  name: string,
): { readonly catalog: string; readonly schema: string; readonly table: string } | undefined => {
  const [catalog, schema, table, ...rest] = name.split(".");
  if (catalog === undefined || schema === undefined || table === undefined || rest.length > 0) {
    return undefined;
  }
  return { catalog, schema, table };
};

export const resolveUcLeafParentIdentity = (
  fields: Readonly<{ catalog?: string; schema?: string; name?: string }>,
): { readonly kind: "schema" | "catalog"; readonly identity: string } | undefined => {
  if (fields.catalog !== undefined && fields.schema !== undefined) {
    return { kind: "schema", identity: `${fields.catalog}.${fields.schema}` };
  }
  if (fields.catalog !== undefined) return { kind: "catalog", identity: fields.catalog };
  const parsed = fields.name === undefined ? undefined : parseThreePartName(fields.name);
  return parsed === undefined
    ? undefined
    : { kind: "schema", identity: `${parsed.catalog}.${parsed.schema}` };
};
