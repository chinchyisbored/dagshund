import { describe, expect, test } from "bun:test";
import { getUnknownProp, isUnknownRecord } from "../../src/utils/unknown-record.ts";

describe("isUnknownRecord", () => {
  test("returns true for plain objects", () => {
    expect(isUnknownRecord({})).toBe(true);
    expect(isUnknownRecord({ a: 1 })).toBe(true);
    expect(isUnknownRecord({ nested: { deep: true } })).toBe(true);
  });

  test("returns false for null", () => {
    expect(isUnknownRecord(null)).toBe(false);
  });

  test("returns false for undefined", () => {
    expect(isUnknownRecord(undefined)).toBe(false);
  });

  test("returns false for primitives", () => {
    expect(isUnknownRecord(42)).toBe(false);
    expect(isUnknownRecord("string")).toBe(false);
    expect(isUnknownRecord(true)).toBe(false);
  });

  test("returns true for arrays (arrays are objects)", () => {
    expect(isUnknownRecord([])).toBe(true);
    expect(isUnknownRecord([1, 2, 3])).toBe(true);
  });
});

describe("getUnknownProp", () => {
  test("returns the property value for a plain object", () => {
    expect(getUnknownProp({ name: "dagshund" }, "name")).toBe("dagshund");
  });

  test("returns undefined for a missing key", () => {
    expect(getUnknownProp({ a: 1 }, "b")).toBeUndefined();
  });

  test("returns undefined for null input", () => {
    expect(getUnknownProp(null, "key")).toBeUndefined();
  });

  test("returns undefined for undefined input", () => {
    expect(getUnknownProp(undefined, "key")).toBeUndefined();
  });

  test("returns undefined for primitive input", () => {
    expect(getUnknownProp(42, "key")).toBeUndefined();
    expect(getUnknownProp("string", "key")).toBeUndefined();
  });

  test("returns nested objects without unwrapping", () => {
    const nested = { inner: true };
    expect(getUnknownProp({ child: nested }, "child")).toBe(nested);
  });
});
