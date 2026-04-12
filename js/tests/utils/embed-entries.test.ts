import { describe, expect, test } from "bun:test";
import {
  expandEmbedEntries,
  filterUnchangedEmbedEntries,
  stripEmbedFromRecord,
} from "../../src/utils/embed-entries.ts";

/** Assert that an object has a bracket-keyed property.
 *  Bun's toHaveProperty interprets `[` as array access, so we check keys directly. */
const expectKey = (obj: Readonly<Record<string, unknown>>, key: string) =>
  expect(Object.keys(obj)).toContain(key);
const expectNoKey = (obj: Readonly<Record<string, unknown>>, key: string) =>
  expect(Object.keys(obj)).not.toContain(key);

// ---------------------------------------------------------------------------
// expandEmbedEntries
// ---------------------------------------------------------------------------

describe("expandEmbedEntries", () => {
  test("returns original record when no __embed__ exists", () => {
    const state = { name: "test", value: 42 };
    expect(expandEmbedEntries(state)).toBe(state);
  });

  test("expands top-level __embed__ into bracket-keyed entries", () => {
    const state = {
      securable_type: "schema",
      __embed__: [
        { principal: "data_engineers", privileges: ["USE_SCHEMA"] },
        { principal: "data_readers", privileges: ["SELECT"] },
      ],
    };
    const result = expandEmbedEntries(state);
    expect(result).toEqual({
      securable_type: "schema",
      "[principal='data_engineers']": { principal: "data_engineers", privileges: ["USE_SCHEMA"] },
      "[principal='data_readers']": { principal: "data_readers", privileges: ["SELECT"] },
    });
    expect(result).not.toHaveProperty("__embed__");
  });

  test("recurses into nested records to expand __embed__", () => {
    const state = {
      name: "test_job",
      permissions: {
        object_id: "/jobs/123",
        __embed__: [
          { level: "CAN_MANAGE", group_name: "admins" },
          { level: "IS_OWNER", user_name: "user1@example.com" },
        ],
      },
    };
    const result = expandEmbedEntries(state);
    expect(result).toHaveProperty("name", "test_job");
    const perms = result["permissions"] as Record<string, unknown>;
    expect(perms).toHaveProperty("object_id", "/jobs/123");
    expect(perms).not.toHaveProperty("__embed__");
    // Both entries should be expanded with bracket labels
    const keys = Object.keys(perms).filter((k) => k.startsWith("["));
    expect(keys).toHaveLength(2);
  });

  test("infers identity from unique string field across entries", () => {
    const state = {
      __embed__: [
        { principal: "engineers", privileges: ["USE"] },
        { principal: "readers", privileges: ["SELECT"] },
      ],
    };
    const result = expandEmbedEntries(state);
    const keys = Object.keys(result);
    expect(keys).toContain("[principal='engineers']");
    expect(keys).toContain("[principal='readers']");
  });

  test("prefers entry-specific field over universal shared attribute", () => {
    const state = {
      __embed__: [
        { level: "CAN_MANAGE", group_name: "admins" },
        { level: "IS_OWNER", user_name: "user1@example.com" },
      ],
    };
    const result = expandEmbedEntries(state);
    // "level" is universal (on both entries) — skip it in favor of per-entry identity
    const keys = Object.keys(result);
    expect(keys).toContain("[group_name='admins']");
    expect(keys).toContain("[user_name='user1@example.com']");
  });

  test("removes __embed__ key for empty array", () => {
    const state = { name: "test", __embed__: [] };
    const result = expandEmbedEntries(state);
    expect(result).toEqual({ name: "test" });
    expect(result).not.toHaveProperty("__embed__");
  });

  test("skips non-object entries in array", () => {
    const state = {
      __embed__: ["not-an-object", { principal: "engineers", privileges: ["USE"] }, 42],
    };
    const result = expandEmbedEntries(state);
    expect(Object.keys(result)).toEqual(["[principal='engineers']"]);
  });

  test("passes through non-array __embed__ value", () => {
    const state = { __embed__: "not-an-array", other: 1 };
    expect(expandEmbedEntries(state)).toBe(state);
  });

  test("handles identity collision (same key for two entries)", () => {
    const state = {
      __embed__: [
        { level: "CAN_VIEW", group_name: "viewers" },
        { level: "CAN_VIEW", group_name: "editors" },
      ],
    };
    const result = expandEmbedEntries(state);
    // "level" has duplicate values → not viable as identity
    // "group_name" is unique → used instead
    const keys = Object.keys(result);
    expect(keys).toContain("[group_name='viewers']");
    expect(keys).toContain("[group_name='editors']");
  });

  test("resolves mixed identity across 3 permission entries", () => {
    const state = {
      __embed__: [
        { level: "IS_OWNER", user_name: "user1@example.com" },
        { level: "CAN_MANAGE", group_name: "admins" },
        { level: "CAN_VIEW", group_name: "viewers" },
      ],
    };
    const result = expandEmbedEntries(state);
    // "level" is universal (all 3 entries) — each entry uses its specific identity field
    const keys = Object.keys(result);
    expect(keys).toContain("[user_name='user1@example.com']");
    expect(keys).toContain("[group_name='admins']");
    expect(keys).toContain("[group_name='viewers']");
  });
});

// ---------------------------------------------------------------------------
// filterUnchangedEmbedEntries
// ---------------------------------------------------------------------------

describe("filterUnchangedEmbedEntries", () => {
  const grantsArray = [
    { principal: "data_engineers", privileges: ["CREATE_TABLE", "USE_SCHEMA"] },
    { principal: "data_analysts", privileges: ["SELECT", "USE_SCHEMA"] },
    { principal: "data_readers", privileges: ["SELECT", "USE_SCHEMA"] },
  ];

  test("returns empty record when all entries are targeted by changes", () => {
    const paths = [
      "[principal='data_engineers']",
      "[principal='data_analysts']",
      "[principal='data_readers']",
    ];
    expect(filterUnchangedEmbedEntries(grantsArray, paths)).toEqual({});
  });

  test("returns only unchanged entries with bracket labels", () => {
    const paths = ["[principal='data_analysts']"];
    const result = filterUnchangedEmbedEntries(grantsArray, paths);
    expectKey(result, "[principal='data_engineers']");
    expectKey(result, "[principal='data_readers']");
    expectNoKey(result, "[principal='data_analysts']");
  });

  test("treats sub-field change path as targeting the whole entry", () => {
    const paths = ["[principal='data_engineers'].privileges"];
    const result = filterUnchangedEmbedEntries(grantsArray, paths);
    expectNoKey(result, "[principal='data_engineers']");
    expectKey(result, "[principal='data_analysts']");
    expectKey(result, "[principal='data_readers']");
  });

  test("treats whole-entry change path as targeting the entry", () => {
    const paths = ["[principal='data_readers']"];
    const result = filterUnchangedEmbedEntries(grantsArray, paths);
    expectKey(result, "[principal='data_engineers']");
    expectKey(result, "[principal='data_analysts']");
    expectNoKey(result, "[principal='data_readers']");
  });

  test("returns all entries when no change paths provided", () => {
    const result = filterUnchangedEmbedEntries(grantsArray, []);
    expect(Object.keys(result)).toHaveLength(3);
    expectKey(result, "[principal='data_engineers']");
    expectKey(result, "[principal='data_analysts']");
    expectKey(result, "[principal='data_readers']");
  });

  test("labels 2 surviving permission entries by identity, not shared attribute", () => {
    const permsArray = [
      { level: "IS_OWNER", user_name: "user1@example.com" },
      { level: "CAN_MANAGE", group_name: "admins" },
      { level: "CAN_VIEW", group_name: "viewers" },
    ];
    const paths = ["[group_name='viewers'].level"];
    const result = filterUnchangedEmbedEntries(permsArray, paths);
    // viewers filtered out; IS_OWNER + admins survive
    // "level" is universal across all 3 entries → skipped as label
    expectNoKey(result, "[group_name='viewers']");
    expectKey(result, "[user_name='user1@example.com']");
    expectKey(result, "[group_name='admins']");
  });

  test("uses per-entry identity from change path fields", () => {
    const permsArray = [
      { level: "CAN_MANAGE", group_name: "admins" },
      { level: "IS_OWNER", user_name: "user1@example.com" },
    ];
    const paths = ["[group_name='admins'].level"];
    const result = filterUnchangedEmbedEntries(permsArray, paths);
    // admins entry is targeted → filtered out
    expectNoKey(result, "[group_name='admins']");
    // IS_OWNER entry survives; "level" is universal across allEntries → skipped
    // "user_name" is non-universal → used as identity
    expectKey(result, "[user_name='user1@example.com']");
    expect(result["[user_name='user1@example.com']"]).toEqual({
      level: "IS_OWNER",
      user_name: "user1@example.com",
    });
  });
});

// ---------------------------------------------------------------------------
// stripEmbedFromRecord
// ---------------------------------------------------------------------------

describe("stripEmbedFromRecord", () => {
  test("expands __embed__ and filters changed entries with bracket-filter paths", () => {
    const record = {
      object_id: "/jobs/123",
      __embed__: [
        { level: "CAN_MANAGE_RUN", group_name: "admins" },
        { level: "IS_OWNER", user_name: "user1@example.com" },
      ],
    };
    const paths = ["[group_name='admins'].level", "[group_name='viewers']"];
    const result = stripEmbedFromRecord(record, paths) as Record<string, unknown>;
    expect(result).toHaveProperty("object_id", "/jobs/123");
    expect(result).not.toHaveProperty("__embed__");
    // admins entry targeted → removed; user1 entry → kept
    const bracketKeys = Object.keys(result).filter((k) => k.startsWith("["));
    expect(bracketKeys).toHaveLength(1);
    const firstBracketKey = bracketKeys[0] ?? "";
    expect(result[firstBracketKey]).toEqual({
      level: "IS_OWNER",
      user_name: "user1@example.com",
    });
  });

  test("handles mixed bracket-filter and regular paths", () => {
    const record = {
      object_id: "/jobs/123",
      name: "test",
      __embed__: [{ level: "CAN_VIEW", group_name: "viewers" }],
    };
    const paths = ["name", "[group_name='viewers']"];
    const result = stripEmbedFromRecord(record, paths) as Record<string, unknown>;
    expect(result).toHaveProperty("object_id", "/jobs/123");
    expect(result).not.toHaveProperty("name"); // stripped by regular path
    expect(result).not.toHaveProperty("__embed__");
    // viewers entry targeted → removed, no entries remain
    const bracketKeys = Object.keys(result).filter((k) => k.startsWith("["));
    expect(bracketKeys).toHaveLength(0);
  });

  test("falls through to stripChangedFields when no bracket-filter paths", () => {
    const record = { name: "test", value: "old" };
    const paths = ["name"];
    const result = stripEmbedFromRecord(record, paths) as Record<string, unknown>;
    expect(result).toEqual({ value: "old" });
  });

  test("passes through record without __embed__ even with bracket-filter paths", () => {
    const record = { name: "test", value: "old" };
    const paths = ["[group_name='admins']"];
    const result = stripEmbedFromRecord(record, paths) as Record<string, unknown>;
    // No __embed__ array → stripped is returned as-is (minus regular paths, of which there are none)
    expect(result).toEqual({ name: "test", value: "old" });
  });

  test("keeps __embed__ untouched when all paths are regular", () => {
    const record = {
      name: "test",
      __embed__: [{ principal: "engineers", privileges: ["USE"] }],
    };
    const paths = ["name"];
    const result = stripEmbedFromRecord(record, paths) as Record<string, unknown>;
    expect(result).toEqual({
      __embed__: [{ principal: "engineers", privileges: ["USE"] }],
    });
  });
});
