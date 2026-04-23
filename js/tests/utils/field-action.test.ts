import { describe, expect, test } from "bun:test";
import fixture from "../../../fixtures/list-element-semantic-cases.json";
import type { ChangeDesc } from "../../src/types/plan-schema.ts";
import {
  deriveFieldAction,
  extractListElementSemantic,
  type FieldChangeContext,
} from "../../src/utils/field-action.ts";

type FixtureCase = {
  readonly name: string;
  readonly changeKey: string;
  readonly newState: unknown;
  readonly remoteState: unknown;
  readonly expected: "create" | "delete" | "update" | null;
};

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

describe("extractListElementSemantic (shared fixture — keeps TS + Python in lockstep)", () => {
  for (const rawCase of fixture.cases as readonly FixtureCase[]) {
    test(rawCase.name, () => {
      const ctx: FieldChangeContext = {
        changeKey: rawCase.changeKey,
        newState: rawCase.newState,
        remoteState: rawCase.remoteState,
        resourceHasShapeDrift: false,
      };
      const expected = rawCase.expected === null ? undefined : rawCase.expected;
      expect(extractListElementSemantic(ctx)).toBe(expected);
    });
  }
});

describe("deriveFieldAction with FieldChangeContext (list-element reclassification)", () => {
  test("reclassifies list-element remote-only → 'delete' when element is in remote but not new", () => {
    const change: ChangeDesc = { action: "update", remote: { task_key: "ingest" } };
    const ctx: FieldChangeContext = {
      changeKey: "depends_on[task_key='ingest']",
      newState: { depends_on: [] },
      remoteState: { depends_on: [{ task_key: "ingest" }] },
      resourceHasShapeDrift: false,
    };
    expect(deriveFieldAction(change, ctx)).toBe("delete");
  });

  test("reclassifies list-element new-only → 'create' when element is in new but not remote", () => {
    const change: ChangeDesc = { action: "update", new: { task_key: "transform" } };
    const ctx: FieldChangeContext = {
      changeKey: "depends_on[task_key='transform']",
      newState: { depends_on: [{ task_key: "transform" }] },
      remoteState: { depends_on: [] },
      resourceHasShapeDrift: false,
    };
    expect(deriveFieldAction(change, ctx)).toBe("create");
  });

  test("non-list-element path falls back to shape-based derivation", () => {
    const change: ChangeDesc = { action: "update", remote: "EDITABLE" };
    const ctx: FieldChangeContext = {
      changeKey: "edit_mode",
      newState: { edit_mode: "UI_LOCKED" },
      remoteState: { edit_mode: "EDITABLE" },
      resourceHasShapeDrift: false,
    };
    expect(deriveFieldAction(change, ctx)).toBe("remote");
  });

  test("no ctx → shape-based derivation preserved (regression guard)", () => {
    const change: ChangeDesc = { action: "update", remote: { task_key: "ingest" } };
    expect(deriveFieldAction(change)).toBe("remote");
  });
});
