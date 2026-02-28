import { z } from "zod/v4";
import type { PlanEntry } from "../types/plan-schema.ts";

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
  const spec = state["spec"];
  if (typeof spec !== "object" || spec === null) return undefined;
  // as: navigating into untyped nested JSON — typeof guard above ensures non-null object
  const name = (spec as Readonly<Record<string, unknown>>)["source_table_full_name"];
  return typeof name === "string" ? name : undefined;
};

/** Parse a three-part UC name ("catalog.schema.table") into components.
 *  Returns undefined if the name doesn't have exactly three dot-separated parts. */
export const parseThreePartName = (
  name: string,
): { readonly catalog: string; readonly schema: string; readonly table: string } | undefined => {
  const parts = name.split(".");
  // length === 3 guarantees these indices exist; TS cannot narrow array access from length checks
  return parts.length === 3
    ? { catalog: parts[0] as string, schema: parts[1] as string, table: parts[2] as string }
    : undefined;
};
