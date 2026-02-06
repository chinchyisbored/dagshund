import { describe, test, expect } from "bun:test";
import { parsePlanJson, parsePlanFromString } from "../../src/parser/parse-plan.ts";

describe("parsePlanJson", () => {
  test("parses a minimal valid plan", () => {
    const result = parsePlanJson({});
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual({});
    }
  });

  test("parses a plan with all top-level fields", () => {
    const input = {
      plan_version: 1,
      cli_version: "0.250.0",
      lineage: "abc-123",
      serial: 42,
      plan: {},
    };
    const result = parsePlanJson(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.plan_version).toBe(1);
      expect(result.data.cli_version).toBe("0.250.0");
      expect(result.data.lineage).toBe("abc-123");
      expect(result.data.serial).toBe(42);
      expect(result.data.plan).toEqual({});
    }
  });

  test("parses a plan with entries and dependencies", () => {
    const input = {
      plan_version: 1,
      plan: {
        "databricks_job.etl_pipeline": {
          id: "123456",
          depends_on: [
            { node: "databricks_cluster.shared", label: "cluster" },
            { node: "databricks_secret_scope.creds" },
          ],
          action: "create",
          new_state: { name: "etl_pipeline" },
          changes: {
            name: {
              action: "create",
              new: "etl_pipeline",
            },
          },
        },
      },
    };
    const result = parsePlanJson(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const entry = result.data.plan?.["databricks_job.etl_pipeline"];
      expect(entry).toBeDefined();
      expect(entry?.id).toBe("123456");
      expect(entry?.depends_on).toHaveLength(2);
      expect(entry?.depends_on?.[0]?.node).toBe("databricks_cluster.shared");
      expect(entry?.depends_on?.[0]?.label).toBe("cluster");
      expect(entry?.depends_on?.[1]?.label).toBeUndefined();
      expect(entry?.action).toBe("create");
      expect(entry?.changes?.["name"]?.action).toBe("create");
    }
  });

  test("parses entries with missing optional fields", () => {
    const input = {
      plan: {
        "databricks_job.minimal": {},
      },
    };
    const result = parsePlanJson(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const entry = result.data.plan?.["databricks_job.minimal"];
      expect(entry).toBeDefined();
      expect(entry?.id).toBeUndefined();
      expect(entry?.depends_on).toBeUndefined();
      expect(entry?.action).toBeUndefined();
      expect(entry?.new_state).toBeUndefined();
      expect(entry?.remote_state).toBeUndefined();
      expect(entry?.changes).toBeUndefined();
    }
  });

  test("returns error for invalid schema", () => {
    const result = parsePlanJson({
      plan_version: "not_a_number",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("expected number");
    }
  });

  test("returns error for invalid action type", () => {
    const result = parsePlanJson({
      plan: {
        "some.resource": {
          action: "invalid_action",
        },
      },
    });
    expect(result.ok).toBe(false);
  });

  test("returns error for non-object input", () => {
    const result = parsePlanJson("not an object");
    expect(result.ok).toBe(false);
  });

  test("returns error for null input", () => {
    const result = parsePlanJson(null);
    expect(result.ok).toBe(false);
  });
});

describe("parsePlanFromString", () => {
  test("parses valid JSON string", () => {
    const result = parsePlanFromString('{"plan_version": 1}');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.plan_version).toBe(1);
    }
  });

  test("returns error for invalid JSON syntax", () => {
    const result = parsePlanFromString("{not valid json}");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Invalid JSON");
    }
  });

  test("returns error for empty string", () => {
    const result = parsePlanFromString("");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Invalid JSON");
    }
  });

  test("returns error for valid JSON but invalid schema", () => {
    const result = parsePlanFromString('{"plan_version": "oops"}');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("expected number");
    }
  });

  test("round-trips through invalid fixture file", async () => {
    const fixture = await Bun.file("tests/fixtures/invalid-plan.json").text();
    const result = parsePlanFromString(fixture);
    expect(result.ok).toBe(false);
  });
});
