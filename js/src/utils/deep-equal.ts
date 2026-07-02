import { isUnknownRecord } from "./unknown-record.ts";

/** Key-order-independent deep equality check. */
export const deepEqual = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, i) => deepEqual(item, b[i]));
  }
  if (isUnknownRecord(a) && isUnknownRecord(b)) {
    const aKeys = Object.keys(a);
    if (aKeys.length !== Object.keys(b).length) return false;
    return aKeys.every((key) => key in b && deepEqual(a[key], b[key]));
  }
  return false;
};
