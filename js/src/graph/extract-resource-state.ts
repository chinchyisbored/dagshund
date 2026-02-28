import { z } from "zod/v4";
import type { PlanEntry } from "../types/plan-schema.ts";
import { getUnknownProp } from "../utils/unknown-record.ts";

// ---------------------------------------------------------------------------
// Zod schemas (parse boundary only)
// ---------------------------------------------------------------------------

/** Schema for new_state: { value: { ...fields } } — generic (no field validation). */
const resourceNewStateSchema = z
  .object({
    value: z.record(z.string(), z.unknown()).readonly().optional(),
  })
  .readonly();

/** Schema for remote_state: { ...fields } — generic (no field validation). */
const resourceRemoteStateSchema = z.record(z.string(), z.unknown()).readonly();

// ---------------------------------------------------------------------------
// State extraction helpers
// ---------------------------------------------------------------------------

/**
 * Safely extract a named field from a plan entry's state.
 * Checks new_state.value first (for live resources), then remote_state (for deleted resources).
 */
export const extractStateField = (entry: PlanEntry, field: string): string | undefined => {
  const parsedNew = resourceNewStateSchema.safeParse(entry.new_state);
  if (parsedNew.success) {
    const fieldValue = parsedNew.data.value?.[field];
    if (typeof fieldValue === "string") return fieldValue;
  }

  const parsedRemote = resourceRemoteStateSchema.safeParse(entry.remote_state);
  if (parsedRemote.success) {
    const fieldValue = parsedRemote.data[field];
    if (typeof fieldValue === "string") return fieldValue;
  }

  return undefined;
};

/** Extract the flat state object from a plan entry (new_state.value or remote_state). */
export const extractResourceState = (
  entry: PlanEntry,
): Readonly<Record<string, unknown>> | undefined => {
  const parsedNew = resourceNewStateSchema.safeParse(entry.new_state);
  if (parsedNew.success && parsedNew.data.value !== undefined) {
    return parsedNew.data.value;
  }

  const parsedRemote = resourceRemoteStateSchema.safeParse(entry.remote_state);
  if (parsedRemote.success) {
    return parsedRemote.data;
  }

  return undefined;
};

/** Extract spec.source_table_full_name from a synced table entry's state. */
export const extractSourceTableFullName = (entry: PlanEntry): string | undefined => {
  const state = extractResourceState(entry);
  if (state === undefined) return undefined;
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
