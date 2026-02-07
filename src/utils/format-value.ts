/** Format a value for display — JSON.stringify with indentation for objects. */
export const formatValue = (value: unknown): string => {
  if (value === undefined || value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  return JSON.stringify(value, null, 2);
};
