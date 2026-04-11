import { describe, expect, test } from "bun:test";
import type { ChangeDesc } from "../../src/types/plan-schema.ts";
import { deriveFieldAction } from "../../src/utils/field-action.ts";

describe("deriveFieldAction", () => {
  test("update with only remote → 'remote'", () => {
    const change: ChangeDesc = { action: "update", remote: "PERFORMANCE_OPTIMIZED" };
    expect(deriveFieldAction(change)).toBe("remote");
  });

  test("update with only new → 'create'", () => {
    const change: ChangeDesc = { action: "update", new: "hello" };
    expect(deriveFieldAction(change)).toBe("create");
  });

  test("update with only old → 'delete'", () => {
    const change: ChangeDesc = { action: "update", old: "goodbye" };
    expect(deriveFieldAction(change)).toBe("delete");
  });

  test("update with both old and new → 'update'", () => {
    const change: ChangeDesc = { action: "update", old: "a", new: "b" };
    expect(deriveFieldAction(change)).toBe("update");
  });

  test("update with old, new, and remote (drift) → 'update'", () => {
    const change: ChangeDesc = { action: "update", old: "x", new: "x", remote: "y" };
    expect(deriveFieldAction(change)).toBe("update");
  });

  test("recreate with only remote → 'remote'", () => {
    const change: ChangeDesc = { action: "recreate", remote: "foo" };
    expect(deriveFieldAction(change)).toBe("remote");
  });

  test("update_id with only new → 'create'", () => {
    const change: ChangeDesc = { action: "update_id", new: "fresh" };
    expect(deriveFieldAction(change)).toBe("create");
  });

  test("resize with old and new → 'resize'", () => {
    const change: ChangeDesc = { action: "resize", old: 1, new: 2 };
    expect(deriveFieldAction(change)).toBe("resize");
  });

  test("create action passes through unchanged", () => {
    const change: ChangeDesc = { action: "create", new: "x" };
    expect(deriveFieldAction(change)).toBe("create");
  });

  test("delete action passes through unchanged", () => {
    const change: ChangeDesc = { action: "delete", old: "x" };
    expect(deriveFieldAction(change)).toBe("delete");
  });

  test("skip action passes through unchanged", () => {
    const change: ChangeDesc = { action: "skip", remote: "x" };
    expect(deriveFieldAction(change)).toBe("skip");
  });

  test("preserves null remote via `in` check", () => {
    const change: ChangeDesc = { action: "update", remote: null };
    expect(deriveFieldAction(change)).toBe("remote");
  });
});
