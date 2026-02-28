/**
 * Safe property access on unknown values.
 *
 * TypeScript cannot narrow `object` to `Record<string, unknown>` via `in`
 * checks alone — a cast is unavoidable for index access. This helper
 * centralises that single cast behind a runtime guard so callers never need
 * `as Record<…>`.
 */

/** Type guard: returns true when the value is a non-null object (i.e. a record). */
export const isUnknownRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null;

/**
 * Safely read a property from an unknown value.
 * Returns `undefined` when the value is not a record or the key is absent.
 */
export const getUnknownProp = (obj: unknown, key: string): unknown => {
  if (typeof obj === "object" && obj !== null && key in obj) {
    return (obj as Record<string, unknown>)[key];
  }
  return undefined;
};
