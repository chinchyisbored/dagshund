import { describe, expect, test } from "bun:test";
import {
  buildDerivedNodeId,
  entryOwnsPromotedPhantomIdentity,
  extractDerivedNodeBadge,
  extractDerivedNodeRefs,
  extractDerivedRenderingConvention,
  extractPromotedPhantomKind,
  resolvePromotedPhantomNodeId,
} from "../../src/graph/derived-node-specs.ts";
import type { PlanEntry } from "../../src/types/plan-schema.ts";

describe("derived node specs", () => {
  test("extracts a valid UC synced table identity", () => {
    const entry: PlanEntry = {
      new_state: {
        value: {
          source_table_full_name: "source.weather.conditions",
          synced_table_id: "generated.weather.conditions",
        },
      },
    };

    expect(extractDerivedNodeRefs("resources.postgres_synced_tables.conditions", entry)).toEqual([
      { derivedKind: "ucSyncedTable", identity: "generated.weather.conditions" },
    ]);
  });

  test("extracts synced_table_id from remote state", () => {
    const entry: PlanEntry = {
      action: "delete",
      remote_state: { synced_table_id: "generated.weather.conditions" },
    };

    expect(extractDerivedNodeRefs("resources.postgres_synced_tables.conditions", entry)).toEqual([
      { derivedKind: "ucSyncedTable", identity: "generated.weather.conditions" },
    ]);
  });

  test("rejects missing and malformed synced table identities", () => {
    const missing: PlanEntry = { new_state: { value: {} } };
    const malformed: PlanEntry = {
      new_state: { value: { synced_table_id: "weather.conditions" } },
    };

    expect(extractDerivedNodeRefs("resources.postgres_synced_tables.missing", missing)).toEqual([]);
    expect(extractDerivedNodeRefs("resources.postgres_synced_tables.malformed", malformed)).toEqual(
      [],
    );
  });

  test("ignores synced_table_id on unrelated resources", () => {
    const entry: PlanEntry = {
      new_state: { value: { synced_table_id: "generated.weather.conditions" } },
    };

    expect(extractDerivedNodeRefs("resources.jobs.conditions", entry)).toEqual([]);
  });

  test("registry provides ID badge and resource rendering convention", () => {
    expect(buildDerivedNodeId("ucSyncedTable", "generated.weather.conditions")).toBe(
      "uc-synced-table::generated.weather.conditions",
    );
    expect(extractDerivedNodeBadge("ucSyncedTable")).toBe("synced table");
    expect(extractDerivedRenderingConvention("ucSyncedTable")).toBe("resource");
    expect(extractPromotedPhantomKind("ucSyncedTable")).toBe("sourceTable");
  });

  test("detects a promoted phantom identity owned by the same entry", () => {
    const entry: PlanEntry = {
      new_state: { value: { synced_table_id: "generated.weather.conditions" } },
    };

    expect(
      entryOwnsPromotedPhantomIdentity(
        "resources.postgres_synced_tables.conditions",
        entry,
        "sourceTable",
        "generated.weather.conditions",
      ),
    ).toBe(true);
    expect(
      entryOwnsPromotedPhantomIdentity(
        "resources.postgres_synced_tables.conditions",
        entry,
        "registeredModel",
        "generated.weather.conditions",
      ),
    ).toBe(false);
  });

  test("promoted phantom resolution prefers derived and falls back to phantom", () => {
    const identity = "generated.weather.conditions";
    const derivedId = `uc-synced-table::${identity}`;
    const phantomId = `source-table::${identity}`;

    expect(resolvePromotedPhantomNodeId("sourceTable", identity, new Set([phantomId]))).toBe(
      phantomId,
    );
    expect(
      resolvePromotedPhantomNodeId("sourceTable", identity, new Set([phantomId, derivedId])),
    ).toBe(derivedId);
  });
});
