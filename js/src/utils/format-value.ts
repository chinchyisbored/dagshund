import { stringify as yamlStringify } from "yaml";

export type ValueFormat = "json" | "yaml";

/** Format a value for display in the selected format. */
export const formatValue = (value: unknown, format: ValueFormat = "json"): string => {
  if (value === undefined) return "<absent>";
  if (value === null) return "null";
  if (format === "yaml") {
    return yamlStringify(value).trimEnd();
  }
  if (typeof value === "string") return JSON.stringify(value);
  return JSON.stringify(value, null, 2);
};
