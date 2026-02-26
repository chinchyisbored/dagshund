import { describe, expect, test } from "bun:test";
import { extractResourceName, extractTypeBadge } from "../../src/utils/resource-key.ts";

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

describe("extractTypeBadge", () => {
  test("returns mapped badge for known resource types", () => {
    expect(extractTypeBadge("resources.schemas.analytics")).toBe("schema");
    expect(extractTypeBadge("resources.jobs.etl_pipeline")).toBe("job");
    expect(extractTypeBadge("resources.synced_database_tables.customer_360")).toBe(
      "synced database table",
    );
    expect(extractTypeBadge("resources.registered_models.fraud_detector")).toBe("model");
    expect(extractTypeBadge("resources.external_locations.my_loc")).toBe("external location");
  });

  test("falls back to raw segment for unknown resource types", () => {
    expect(extractTypeBadge("resources.unknown_widgets.foo")).toBe("unknown_widgets");
  });

  test("returns undefined when key has no type segment", () => {
    expect(extractTypeBadge("resources")).toBeUndefined();
    expect(extractTypeBadge("")).toBeUndefined();
  });
});
