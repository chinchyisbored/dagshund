import { describe, expect, test } from "bun:test";
import { formatValue } from "../../src/utils/format-value.ts";

describe("formatValue", () => {
  test("returns '<absent>' for undefined", () => {
    expect(formatValue(undefined)).toBe("<absent>");
  });

  test("returns 'null' for null", () => {
    expect(formatValue(null)).toBe("null");
  });

  test("formats string as JSON-quoted by default", () => {
    expect(formatValue("hello")).toBe('"hello"');
  });

  test("formats number as JSON", () => {
    expect(formatValue(42)).toBe("42");
  });

  test("formats boolean as JSON", () => {
    expect(formatValue(true)).toBe("true");
  });

  test("formats object as pretty-printed JSON by default", () => {
    const result = formatValue({ a: 1, b: "two" });
    expect(result).toBe('{\n  "a": 1,\n  "b": "two"\n}');
  });

  test("formats array as pretty-printed JSON by default", () => {
    const result = formatValue([1, 2, 3]);
    expect(result).toBe("[\n  1,\n  2,\n  3\n]");
  });

  test("formats object as YAML when format is yaml", () => {
    const result = formatValue({ a: 1, b: "two" }, "yaml");
    expect(result).toBe("a: 1\nb: two");
  });

  test("formats string as YAML when format is yaml", () => {
    const result = formatValue("hello", "yaml");
    expect(result).toBe("hello");
  });

  test("trims trailing whitespace from YAML output", () => {
    // yaml stringify adds a trailing newline; trimEnd should remove it
    const result = formatValue({ key: "value" }, "yaml");
    expect(result).not.toMatch(/\s$/);
  });

  test("returns 'null' for null regardless of format", () => {
    const result = formatValue(null, "yaml");
    expect(result).toBe("null");
  });

  test("returns '<absent>' for undefined regardless of format", () => {
    expect(formatValue(undefined, "yaml")).toBe("<absent>");
    expect(formatValue(undefined, "json")).toBe("<absent>");
  });
});
