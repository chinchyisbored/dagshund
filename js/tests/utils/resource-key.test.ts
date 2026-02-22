import { describe, expect, test } from "bun:test";
import { extractResourceName } from "../../src/utils/resource-key.ts";

describe("extractResourceName", () => {
  test("returns last segment of a dotted key", () => {
    expect(extractResourceName("databricks_job.my_pipeline")).toBe("my_pipeline");
  });

  test("returns last segment for deeply nested keys", () => {
    expect(extractResourceName("a.b.c.d")).toBe("d");
  });

  test("returns the key itself for a single segment", () => {
    expect(extractResourceName("my_resource")).toBe("my_resource");
  });

  test("returns empty string for empty input", () => {
    expect(extractResourceName("")).toBe("");
  });

  test("handles key with trailing dot", () => {
    // "foo.".split(".") => ["foo", ""] — last segment is ""
    expect(extractResourceName("foo.")).toBe("");
  });

  test("handles key with leading dot", () => {
    // ".foo".split(".") => ["", "foo"] — last segment is "foo"
    expect(extractResourceName(".foo")).toBe("foo");
  });
});
