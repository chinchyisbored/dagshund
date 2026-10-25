import type { PlanEntry } from "../types/plan-schema.ts";
import { getUnknownProp } from "./unknown-record.ts";

export type EffectiveResourceState =
  | { readonly origin: "new"; readonly snapshot: unknown }
  | { readonly origin: "remote"; readonly snapshot: unknown }
  | { readonly origin: "absent"; readonly snapshot: undefined };

/** Select one snapshot for current semantics without validating its resource shape. */
export const selectEffectiveResourceState = (entry: PlanEntry): EffectiveResourceState => {
  if (entry.action === "delete") {
    return entry.remote_state === undefined
      ? { origin: "absent", snapshot: undefined }
      : { origin: "remote", snapshot: entry.remote_state };
  }

  if (entry.new_state !== undefined) {
    const wrapperValue = getUnknownProp(entry.new_state, "value");
    const isRecord =
      typeof entry.new_state === "object" &&
      entry.new_state !== null &&
      !Array.isArray(entry.new_state);
    if (isRecord && wrapperValue === undefined) {
      return entry.remote_state === undefined
        ? { origin: "absent", snapshot: undefined }
        : { origin: "remote", snapshot: entry.remote_state };
    }
    return { origin: "new", snapshot: isRecord ? wrapperValue : entry.new_state };
  }

  return entry.remote_state === undefined
    ? { origin: "absent", snapshot: undefined }
    : { origin: "remote", snapshot: entry.remote_state };
};
