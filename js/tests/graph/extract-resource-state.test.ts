import { describe, expect, test } from "bun:test";
import {
  extractResourceState,
  extractSourceTableFullName,
  extractStateField,
  parseThreePartName,
} from "../../src/graph/extract-resource-state.ts";
import type { PlanEntry } from "../../src/types/plan-schema.ts";
import { loadFixture } from "../helpers/load-fixture.ts";

// ---------------------------------------------------------------------------
// extractStateField
// ---------------------------------------------------------------------------

describe("extractStateField", () => {
  test("extracts field from new_state.value", () => {
    const entry: PlanEntry = {
      new_state: { value: { name: "my-job", format: "MULTI_TASK" } },
    };

    expect(extractStateField(entry, "name")).toBe("my-job");
  });

  test("extracts field from remote_state when new_state missing", () => {
    const entry: PlanEntry = {
      remote_state: { name: "my-job", format: "MULTI_TASK" },
    };

    expect(extractStateField(entry, "name")).toBe("my-job");
  });

  test("prefers new_state over remote_state", () => {
    const entry: PlanEntry = {
      new_state: { value: { name: "new-name" } },
      remote_state: { name: "old-name" },
    };

    expect(extractStateField(entry, "name")).toBe("new-name");
  });

  test("falls back to remote_state when field missing from new_state", () => {
    const entry: PlanEntry = {
      new_state: { value: { other: "val" } },
      remote_state: { name: "remote-name" },
    };

    expect(extractStateField(entry, "name")).toBe("remote-name");
  });

  test("returns undefined when field absent from both states", () => {
    const entry: PlanEntry = {
      new_state: { value: { other: "val" } },
      remote_state: { other: "val" },
    };

    expect(extractStateField(entry, "name")).toBeUndefined();
  });

  test("returns undefined when both states are undefined", () => {
    const entry: PlanEntry = {};

    expect(extractStateField(entry, "name")).toBeUndefined();
  });

  test("returns undefined when field value is not a string", () => {
    const entry: PlanEntry = {
      new_state: { value: { count: 42 } },
      remote_state: { count: 99 },
    };

    expect(extractStateField(entry, "count")).toBeUndefined();
  });

  test("returns undefined when new_state has no value key", () => {
    const entry: PlanEntry = {
      new_state: { something_else: "data" },
    };

    expect(extractStateField(entry, "something_else")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// extractResourceState
// ---------------------------------------------------------------------------

describe("extractResourceState", () => {
  test("returns new_state.value when present", () => {
    const entry: PlanEntry = {
      new_state: { value: { name: "my-job", format: "MULTI_TASK" } },
    };

    const state = extractResourceState(entry);
    expect(state).toEqual({ name: "my-job", format: "MULTI_TASK" });
  });

  test("returns remote_state when new_state has no value", () => {
    const entry: PlanEntry = {
      remote_state: { name: "my-job", job_id: 12345 },
    };

    const state = extractResourceState(entry);
    expect(state).toEqual({ name: "my-job", job_id: 12345 });
  });

  test("prefers new_state.value over remote_state", () => {
    const entry: PlanEntry = {
      new_state: { value: { name: "new" } },
      remote_state: { name: "old" },
    };

    expect(extractResourceState(entry)).toEqual({ name: "new" });
  });

  test("returns undefined when both states are absent", () => {
    const entry: PlanEntry = {};

    expect(extractResourceState(entry)).toBeUndefined();
  });

  test("falls back to remote_state when new_state.value is undefined", () => {
    const entry: PlanEntry = {
      new_state: {},
      remote_state: { name: "fallback" },
    };

    expect(extractResourceState(entry)).toEqual({ name: "fallback" });
  });

  test("returns undefined when new_state is not an object", () => {
    const entry: PlanEntry = {
      new_state: "not-an-object",
    };

    expect(extractResourceState(entry)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// extractSourceTableFullName
// ---------------------------------------------------------------------------

describe("extractSourceTableFullName", () => {
  test("extracts source_table_full_name from spec", () => {
    const entry: PlanEntry = {
      new_state: {
        value: {
          spec: { source_table_full_name: "catalog.schema.table" },
        },
      },
    };

    expect(extractSourceTableFullName(entry)).toBe("catalog.schema.table");
  });

  test("returns undefined when spec is missing", () => {
    const entry: PlanEntry = {
      new_state: { value: { name: "no-spec" } },
    };

    expect(extractSourceTableFullName(entry)).toBeUndefined();
  });

  test("returns undefined when source_table_full_name is missing from spec", () => {
    const entry: PlanEntry = {
      new_state: {
        value: { spec: { other_field: "value" } },
      },
    };

    expect(extractSourceTableFullName(entry)).toBeUndefined();
  });

  test("returns undefined when state is absent", () => {
    const entry: PlanEntry = {};

    expect(extractSourceTableFullName(entry)).toBeUndefined();
  });

  test("returns undefined when source_table_full_name is not a string", () => {
    const entry: PlanEntry = {
      new_state: {
        value: { spec: { source_table_full_name: 42 } },
      },
    };

    expect(extractSourceTableFullName(entry)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// parseThreePartName
// ---------------------------------------------------------------------------

describe("parseThreePartName", () => {
  test("parses a valid three-part name", () => {
    expect(parseThreePartName("catalog.schema.table")).toEqual({
      catalog: "catalog",
      schema: "schema",
      table: "table",
    });
  });

  test("returns undefined for two-part name", () => {
    expect(parseThreePartName("schema.table")).toBeUndefined();
  });

  test("returns undefined for single-part name", () => {
    expect(parseThreePartName("table")).toBeUndefined();
  });

  test("returns undefined for four-part name", () => {
    expect(parseThreePartName("a.b.c.d")).toBeUndefined();
  });

  test("returns undefined for empty string", () => {
    expect(parseThreePartName("")).toBeUndefined();
  });

  test("handles dots in parts correctly (only splits on dot)", () => {
    expect(parseThreePartName("my-catalog.my-schema.my-table")).toEqual({
      catalog: "my-catalog",
      schema: "my-schema",
      table: "my-table",
    });
  });
});

// ---------------------------------------------------------------------------
// Fixture-based integration tests
// ---------------------------------------------------------------------------

describe("fixture-based extraction", () => {
  test("extracts state from complex-plan job entries", async () => {
    const plan = await loadFixture("complex-plan.json");
    const entries = Object.entries(plan.plan ?? {});

    const jobEntries = entries.filter(([key]) => key.includes("resources.jobs."));
    expect(jobEntries.length).toBeGreaterThan(0);

    for (const [, entry] of jobEntries) {
      const state = extractResourceState(entry);
      expect(state).toBeDefined();
    }
  });

  test("extracts source_table_full_name from all-hierarchies synced tables", async () => {
    const plan = await loadFixture("all-hierarchies-plan.json");
    const entries = Object.entries(plan.plan ?? {});

    const syncedTableEntries = entries.filter(([key]) => key.includes("synced_database_tables."));
    expect(syncedTableEntries.length).toBeGreaterThan(0);

    for (const [, entry] of syncedTableEntries) {
      const name = extractSourceTableFullName(entry);
      expect(name).toBeDefined();

      // biome-ignore lint/style/noNonNullAssertion: asserted above
      const parsed = parseThreePartName(name!);
      expect(parsed).toBeDefined();
      expect(parsed?.catalog).toBe("dagshund");
    }
  });

  test("returns undefined for entries without state", async () => {
    const plan = await loadFixture("sample-plan.json");
    const entries = Object.entries(plan.plan ?? {});
    expect(entries.length).toBeGreaterThan(0);

    for (const [, entry] of entries) {
      const state = extractResourceState(entry);
      if (entry.new_state === undefined && entry.remote_state === undefined) {
        expect(state).toBeUndefined();
      }
    }
  });
});
