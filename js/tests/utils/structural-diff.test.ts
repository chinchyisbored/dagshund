import { describe, expect, test } from "bun:test";
import type { ChangeDesc } from "../../src/types/plan-schema.ts";
import {
  computeStructuralDiff,
  diffArrays,
  diffObjects,
  findIdentityKey,
  hasAnyDriftWithContext,
  hasTaskDriftWithContext,
  isReclassifiedListElementDriftChange,
  isTopologyDriftChange,
} from "../../src/utils/structural-diff.ts";

describe("findIdentityKey", () => {
  test("returns undefined for empty arrays", () => {
    expect(findIdentityKey([], [])).toBeUndefined();
  });

  test("returns undefined for arrays of primitives", () => {
    expect(findIdentityKey([1, 2], [3])).toBeUndefined();
  });

  test("returns undefined when no common key across arrays", () => {
    expect(findIdentityKey([{ a: "x" }], [{ b: "y" }])).toBeUndefined();
  });

  test("detects task_key as identity in depends_on arrays", () => {
    const oldArr = [{ task_key: "extract" }];
    const newArr = [{ task_key: "extract" }, { task_key: "transform" }];
    expect(findIdentityKey(oldArr, newArr)).toBe("task_key");
  });

  test("detects identity from a single array when the other is empty", () => {
    const items = [{ task_key: "extract" }, { task_key: "transform" }, { task_key: "load" }];
    expect(findIdentityKey(items, [])).toBe("task_key");
  });

  test("picks the most common unique-valued string key", () => {
    const items = [
      { id: "1", name: "a", tag: "x" },
      { id: "2", name: "b", tag: "x" }, // tag has duplicate "x"
      { id: "3", name: "c", tag: "y" },
    ];
    // "tag" has duplicate values → not unique. "id" and "name" both present in 3, both unique.
    const result = findIdentityKey(items, []);
    expect(result === "id" || result === "name").toBe(true);
  });

  test("ignores non-string values", () => {
    const items = [
      { id: 1, name: "a" },
      { id: 2, name: "b" },
    ];
    expect(findIdentityKey(items, [])).toBe("name");
  });

  test("handles key present in some but not all elements", () => {
    const oldArr = [{ task_key: "a", other: "x" }];
    const newArr = [{ task_key: "b" }, { other: "y" }];
    // task_key: count=2 (one per array), other: count=2 (one per array)
    const result = findIdentityKey(oldArr, newArr);
    expect(result === "task_key" || result === "other").toBe(true);
  });

  test("returns undefined when all keys have duplicate values within an array", () => {
    expect(findIdentityKey([{ type: "foo" }, { type: "foo" }], [])).toBeUndefined();
  });

  test("allows same value across old and new arrays", () => {
    // "extract" appears in both old and new — that's fine, it's the same element
    const result = findIdentityKey(
      [{ task_key: "extract" }],
      [{ task_key: "extract" }, { task_key: "transform" }],
    );
    expect(result).toBe("task_key");
  });
});

describe("diffArrays", () => {
  test("detects added elements with identity key", () => {
    const oldArr = [{ task_key: "extract" }];
    const newArr = [{ task_key: "extract" }, { task_key: "transform" }];
    const result = diffArrays(oldArr, newArr);

    expect(result.kind).toBe("array");
    expect(result.elements).toHaveLength(2);

    const unchanged = result.elements.find((e) => e.status === "unchanged");
    expect(unchanged).toBeDefined();
    expect(unchanged?.identityLabel).toBe("task_key=extract");

    const added = result.elements.find((e) => e.status === "added");
    expect(added).toBeDefined();
    expect(added?.identityLabel).toBe("task_key=transform");
  });

  test("detects removed elements with identity key", () => {
    const oldArr = [{ task_key: "a" }, { task_key: "b" }];
    const newArr = [{ task_key: "a" }];
    const result = diffArrays(oldArr, newArr);

    expect(result.elements).toHaveLength(2);

    const removed = result.elements.find((e) => e.status === "removed");
    expect(removed).toBeDefined();
    expect(removed?.identityLabel).toBe("task_key=b");
  });

  test("handles simultaneous additions and removals", () => {
    const oldArr = [{ task_key: "a" }, { task_key: "b" }];
    const newArr = [{ task_key: "a" }, { task_key: "c" }];
    const result = diffArrays(oldArr, newArr);

    expect(result.elements).toHaveLength(3);
    expect(result.elements.filter((e) => e.status === "unchanged")).toHaveLength(1);
    expect(result.elements.filter((e) => e.status === "added")).toHaveLength(1);
    expect(result.elements.filter((e) => e.status === "removed")).toHaveLength(1);
  });

  test("falls back to deep equality for primitives", () => {
    const oldArr = [1, 2, 3];
    const newArr = [1, 3, 4];
    const result = diffArrays(oldArr, newArr);

    expect(result.elements.filter((e) => e.status === "unchanged")).toHaveLength(2); // 1, 3
    expect(result.elements.filter((e) => e.status === "added")).toHaveLength(1); // 4
    expect(result.elements.filter((e) => e.status === "removed")).toHaveLength(1); // 2
  });

  test("handles empty arrays", () => {
    expect(diffArrays([], []).elements).toHaveLength(0);
    expect(diffArrays([], [1]).elements).toEqual([
      { status: "added", value: 1, identityLabel: undefined },
    ]);
    expect(diffArrays([1], []).elements).toEqual([
      { status: "removed", value: 1, identityLabel: undefined },
    ]);
  });

  test("identity labels are undefined for elements without identity key", () => {
    const result = diffArrays([1], [1, 2]);
    for (const element of result.elements) {
      expect(element.identityLabel).toBeUndefined();
    }
  });
});

describe("diffObjects", () => {
  test("detects added keys", () => {
    const result = diffObjects({ a: 1 }, { a: 1, b: 2 });
    const added = result.entries.find((e) => e.key === "b");
    expect(added?.status).toBe("added");
    expect(added?.new).toBe(2);
  });

  test("detects removed keys", () => {
    const result = diffObjects({ a: 1, b: 2 }, { a: 1 });
    const removed = result.entries.find((e) => e.key === "b");
    expect(removed?.status).toBe("removed");
    expect(removed?.old).toBe(2);
  });

  test("detects modified keys", () => {
    const result = diffObjects({ a: 1 }, { a: 2 });
    const modified = result.entries.find((e) => e.key === "a");
    expect(modified?.status).toBe("modified");
    expect(modified?.old).toBe(1);
    expect(modified?.new).toBe(2);
  });

  test("detects unchanged keys", () => {
    const result = diffObjects({ a: 1 }, { a: 1 });
    expect(result.entries[0]?.status).toBe("unchanged");
  });

  test("sorts entries: modified → added → removed → unchanged", () => {
    const result = diffObjects(
      { unchanged: 1, removed: 2, changed: "old" },
      { unchanged: 1, added: 3, changed: "new" },
    );
    const statuses = result.entries.map((e) => e.status);
    expect(statuses).toEqual(["modified", "added", "removed", "unchanged"]);
  });

  test("handles empty objects", () => {
    expect(diffObjects({}, {}).entries).toHaveLength(0);
  });

  test("deep-compares nested values", () => {
    const result = diffObjects({ nested: { a: 1 } }, { nested: { a: 1 } });
    expect(result.entries[0]?.status).toBe("unchanged");

    const modified = diffObjects({ nested: { a: 1 } }, { nested: { a: 2 } });
    expect(modified.entries[0]?.status).toBe("modified");
  });

  test("treats objects with different key ordering as unchanged", () => {
    const result = diffObjects({ config: { b: 2, a: 1 } }, { config: { a: 1, b: 2 } });
    expect(result.entries[0]?.status).toBe("unchanged");
  });
});

/** Narrow a result to its diff variant for assertions; fail the test otherwise. */
const asDiff = (
  result: ReturnType<typeof computeStructuralDiff>,
): Extract<ReturnType<typeof computeStructuralDiff>, { kind: "diff" }> => {
  if (result.kind !== "diff") {
    throw new Error(`expected diff result, got ${result.kind}`);
  }
  return result;
};

describe("computeStructuralDiff", () => {
  test("create-only when action is create with no baseline", () => {
    const change: ChangeDesc = { action: "create", new: "hello" };
    const result = asDiff(computeStructuralDiff(change));
    expect(result.diff.kind).toBe("create-only");
    if (result.diff.kind === "create-only") {
      expect(result.diff.value).toBe("hello");
    }
    expect(result.baselineLabel).toBe("old");
    expect(result.semantic).toBe("normal");
  });

  test("delete-only when action is delete with no new", () => {
    const change: ChangeDesc = { action: "delete", old: "goodbye" };
    const result = asDiff(computeStructuralDiff(change));
    expect(result.diff.kind).toBe("delete-only");
    if (result.diff.kind === "delete-only") {
      expect(result.diff.value).toBe("goodbye");
    }
    expect(result.baselineLabel).toBe("old");
    expect(result.semantic).toBe("normal");
  });

  test("scalar diff for primitive values", () => {
    const change: ChangeDesc = { action: "update", old: "before", new: "after" };
    const result = asDiff(computeStructuralDiff(change));
    expect(result.diff.kind).toBe("scalar");
    if (result.diff.kind === "scalar") {
      expect(result.diff.old).toBe("before");
      expect(result.diff.new).toBe("after");
    }
    expect(result.baselineLabel).toBe("old");
    expect(result.semantic).toBe("normal");
  });

  test("scalar diff for number values", () => {
    const change: ChangeDesc = { action: "update", old: 1, new: 2 };
    const result = asDiff(computeStructuralDiff(change));
    expect(result.diff.kind).toBe("scalar");
  });

  test("scalar diff for boolean values", () => {
    const change: ChangeDesc = { action: "update", old: true, new: false };
    const result = asDiff(computeStructuralDiff(change));
    expect(result.diff.kind).toBe("scalar");
  });

  test("array diff when both values are arrays", () => {
    const change: ChangeDesc = {
      action: "update",
      old: [{ task_key: "a" }],
      new: [{ task_key: "a" }, { task_key: "b" }],
    };
    const result = asDiff(computeStructuralDiff(change));
    expect(result.diff.kind).toBe("array");
    if (result.diff.kind === "array") {
      expect(result.diff.elements).toHaveLength(2);
      expect(result.diff.elements.filter((e) => e.status === "added")).toHaveLength(1);
    }
  });

  test("object diff when both values are objects", () => {
    const change: ChangeDesc = {
      action: "update",
      old: { a: 1 },
      new: { a: 2, b: 3 },
    };
    const result = asDiff(computeStructuralDiff(change));
    expect(result.diff.kind).toBe("object");
    if (result.diff.kind === "object") {
      expect(result.diff.entries).toHaveLength(2);
    }
  });

  test("scalar diff when types mismatch (array vs object)", () => {
    const change: ChangeDesc = { action: "update", old: [1], new: { a: 1 } };
    const result = asDiff(computeStructuralDiff(change));
    expect(result.diff.kind).toBe("scalar");
  });

  test("remote fallback when old is missing but new is present", () => {
    const change: ChangeDesc = {
      action: "update",
      remote: [{ task_key: "a" }],
      new: [{ task_key: "a" }, { task_key: "b" }],
    };
    const result = asDiff(computeStructuralDiff(change));
    expect(result.baselineLabel).toBe("remote");
    expect(result.diff.kind).toBe("array");
    expect(result.semantic).toBe("normal");
  });

  test("prefers old over remote when both exist", () => {
    const change: ChangeDesc = {
      action: "update",
      old: "from-old",
      remote: "from-remote",
      new: "to-new",
    };
    const result = asDiff(computeStructuralDiff(change));
    expect(result.baselineLabel).toBe("old");
    if (result.diff.kind === "scalar") {
      expect(result.diff.old).toBe("from-old");
    }
  });

  test("create-only when no baseline and action is not create", () => {
    const change: ChangeDesc = { action: "update", new: "value" };
    const result = asDiff(computeStructuralDiff(change));
    expect(result.diff.kind).toBe("create-only");
  });

  test("delete-only for remote-only baseline on delete", () => {
    const change: ChangeDesc = { action: "delete", remote: "remote-val" };
    const result = asDiff(computeStructuralDiff(change));
    expect(result.diff.kind).toBe("delete-only");
    expect(result.baselineLabel).toBe("remote");
    if (result.diff.kind === "delete-only") {
      expect(result.diff.value).toBe("remote-val");
    }
  });

  test("drift: swaps baseline to remote when old == new and remote differs", () => {
    const change: ChangeDesc = {
      action: "update",
      old: "UI_LOCKED",
      new: "UI_LOCKED",
      remote: "EDITABLE",
    };
    const result = asDiff(computeStructuralDiff(change));
    expect(result.baselineLabel).toBe("remote");
    expect(result.semantic).toBe("drift");
    expect(result.diff.kind).toBe("scalar");
    if (result.diff.kind === "scalar") {
      expect(result.diff.old).toBe("EDITABLE");
      expect(result.diff.new).toBe("UI_LOCKED");
    }
  });

  test("drift: swaps baseline to remote for object values", () => {
    const change: ChangeDesc = {
      action: "update",
      old: { a: 1, b: 2 },
      new: { a: 1, b: 2 },
      remote: { a: 1, b: 99 },
    };
    const result = asDiff(computeStructuralDiff(change));
    expect(result.baselineLabel).toBe("remote");
    expect(result.semantic).toBe("drift");
    expect(result.diff.kind).toBe("object");
  });

  test("no drift swap when old != new (genuine change)", () => {
    const change: ChangeDesc = {
      action: "update",
      old: "before",
      new: "after",
      remote: "something",
    };
    const result = asDiff(computeStructuralDiff(change));
    expect(result.baselineLabel).toBe("old");
    expect(result.semantic).toBe("normal");
    if (result.diff.kind === "scalar") {
      expect(result.diff.old).toBe("before");
      expect(result.diff.new).toBe("after");
    }
  });

  test("no drift swap when old == new == remote (all identical)", () => {
    const change: ChangeDesc = {
      action: "update",
      old: "same",
      new: "same",
      remote: "same",
    };
    const result = asDiff(computeStructuralDiff(change));
    // No swap — falls through to normal old-based diff
    expect(result.baselineLabel).toBe("old");
    expect(result.semantic).toBe("normal");
  });

  test("drift: detects old == new == null with non-null remote via `in` check", () => {
    // Pins the `"old" in change` idiom on the drift branch: a drift where
    // both sides are explicitly null must still be detected, matching the
    // remote-only branch's presence check and Python's field_action_config.
    const change: ChangeDesc = {
      action: "update",
      old: null,
      new: null,
      remote: "something",
    };
    const result = asDiff(computeStructuralDiff(change));
    expect(result.semantic).toBe("drift");
    expect(result.baselineLabel).toBe("remote");
    expect(result.diff).toEqual({ kind: "scalar", old: "something", new: null });
  });

  test("remote-only: update action with only remote returns remote-only kind", () => {
    const change: ChangeDesc = { action: "update", remote: "PERFORMANCE_OPTIMIZED" };
    const result = computeStructuralDiff(change);
    expect(result.kind).toBe("remote-only");
    if (result.kind === "remote-only") {
      expect(result.value).toBe("PERFORMANCE_OPTIMIZED");
    }
  });

  test("remote-only: does not route through delete-only (regression guard)", () => {
    // Before the fix, {action: "update", remote: ...} fell through to delete-only,
    // rendering as a red "-" block.
    const change: ChangeDesc = {
      action: "update",
      remote: { no_alert_for_skipped_runs: false },
    };
    const result = computeStructuralDiff(change);
    expect(result.kind).toBe("remote-only");
  });

  test("remote-only: preserves null remote value via `in` check", () => {
    // Pins the `"remote" in change` idiom: an explicit null remote must still be
    // classified as remote-only, not fall through to the baseline fallback.
    const change: ChangeDesc = { action: "update", remote: null };
    const result = computeStructuralDiff(change);
    expect(result.kind).toBe("remote-only");
    if (result.kind === "remote-only") {
      expect(result.value).toBeNull();
    }
  });

  test("remote-only: preserves empty object remote value", () => {
    const change: ChangeDesc = { action: "update", remote: {} };
    const result = computeStructuralDiff(change);
    expect(result.kind).toBe("remote-only");
    if (result.kind === "remote-only") {
      expect(result.value).toEqual({});
    }
  });

  test("remote-only: preserves empty array remote value", () => {
    const change: ChangeDesc = { action: "update", remote: [] };
    const result = computeStructuralDiff(change);
    expect(result.kind).toBe("remote-only");
    if (result.kind === "remote-only") {
      expect(result.value).toEqual([]);
    }
  });

  test("delete action with only remote still returns delete-only, not remote-only", () => {
    // Regression: the delete-only early branch must run before the remote-only
    // branch so `{action: "delete", remote: ...}` keeps its delete semantics.
    const change: ChangeDesc = { action: "delete", remote: "gone" };
    const result = asDiff(computeStructuralDiff(change));
    expect(result.diff.kind).toBe("delete-only");
  });

  describe("list-element reclassification via FieldChangeContext (dagshund-1naj)", () => {
    test("remote-only list-element shape with ctx → delete-only with baselineLabel=remote", () => {
      const change: ChangeDesc = { action: "update", remote: { task_key: "ingest" } };
      const ctx = {
        changeKey: "depends_on[task_key='ingest']",
        newState: { depends_on: [] },
        remoteState: { depends_on: [{ task_key: "ingest" }] },
        resourceHasShapeDrift: false,
      };
      const result = asDiff(computeStructuralDiff(change, ctx));
      expect(result.diff.kind).toBe("delete-only");
      expect(result.baselineLabel).toBe("remote");
    });

    test("drift tag applied when resourceHasShapeDrift is true", () => {
      const change: ChangeDesc = { action: "update", remote: { task_key: "ingest" } };
      const ctx = {
        changeKey: "depends_on[task_key='ingest']",
        newState: { depends_on: [] },
        remoteState: { depends_on: [{ task_key: "ingest" }] },
        resourceHasShapeDrift: true,
      };
      const result = asDiff(computeStructuralDiff(change, ctx));
      expect(result.semantic).toBe("drift");
    });

    test("no drift tag when resourceHasShapeDrift is false", () => {
      const change: ChangeDesc = { action: "update", remote: { task_key: "ingest" } };
      const ctx = {
        changeKey: "depends_on[task_key='ingest']",
        newState: { depends_on: [] },
        remoteState: { depends_on: [{ task_key: "ingest" }] },
        resourceHasShapeDrift: false,
      };
      const result = asDiff(computeStructuralDiff(change, ctx));
      expect(result.semantic).toBe("normal");
    });

    test("remote-only list-element classified as create when element is in new, not remote", () => {
      const change: ChangeDesc = { action: "update", remote: { task_key: "transform" } };
      const ctx = {
        changeKey: "depends_on[task_key='transform']",
        newState: { depends_on: [{ task_key: "transform" }] },
        remoteState: { depends_on: [] },
        resourceHasShapeDrift: false,
      };
      const result = asDiff(computeStructuralDiff(change, ctx));
      expect(result.diff.kind).toBe("create-only");
    });

    test("non-list-element path falls through to shape-based rendering", () => {
      const change: ChangeDesc = { action: "update", remote: "EDITABLE" };
      const ctx = {
        changeKey: "edit_mode",
        newState: { edit_mode: "UI_LOCKED" },
        remoteState: { edit_mode: "EDITABLE" },
        resourceHasShapeDrift: false,
      };
      const result = computeStructuralDiff(change, ctx);
      expect(result.kind).toBe("remote-only");
    });

    test("whole-task delete shape (has old + remote) is not overridden — keeps existing rendering", () => {
      // Regression: my first pass over-triggered on any key ending in [field='value'].
      // Whole-task deletes carry old+remote and should still use the shape-based
      // delete-only branch (which picks baselineLabel=old via the format_display_value path).
      const change: ChangeDesc = {
        action: "update",
        old: { task_key: "standby", notebook_task: { notebook_path: "/x" } },
        remote: { task_key: "standby", notebook_task: { notebook_path: "/x" } },
      };
      const ctx = {
        changeKey: "tasks[task_key='standby']",
        newState: { tasks: [] },
        remoteState: { tasks: [{ task_key: "standby" }] },
        resourceHasShapeDrift: false,
      };
      const result = asDiff(computeStructuralDiff(change, ctx));
      // Shape-based logic: old is present, current is undefined → delete-only with baselineLabel=old.
      expect(result.diff.kind).toBe("delete-only");
      expect(result.baselineLabel).toBe("old");
    });
  });
});

describe("isTopologyDriftChange", () => {
  test("positive: whole-task re-add shape", () => {
    const change: ChangeDesc = {
      action: "update",
      old: {
        depends_on: [{ task_key: "ingest" }],
        notebook_task: { notebook_path: "/Workspace/drift/transform" },
        task_key: "transform",
      },
      new: {
        depends_on: [{ task_key: "ingest" }],
        notebook_task: { notebook_path: "/Workspace/drift/transform" },
        task_key: "transform",
      },
    };
    expect(isTopologyDriftChange(change)).toBe(true);
  });

  test("positive: grant re-add shape", () => {
    const change: ChangeDesc = {
      action: "update",
      old: { principal: "data_engineers", privileges: ["CREATE_TABLE", "USE_SCHEMA"] },
      new: { principal: "data_engineers", privileges: ["CREATE_TABLE", "USE_SCHEMA"] },
    };
    expect(isTopologyDriftChange(change)).toBe(true);
  });

  test("negative: field-level drift has remote present", () => {
    const change: ChangeDesc = {
      action: "update",
      old: "UI_LOCKED",
      new: "UI_LOCKED",
      remote: "EDITABLE",
    };
    expect(isTopologyDriftChange(change)).toBe(false);
  });

  test("negative: regular update where old differs from new", () => {
    const change: ChangeDesc = { action: "update", old: "a", new: "b" };
    expect(isTopologyDriftChange(change)).toBe(false);
  });

  test("negative: create action", () => {
    const change: ChangeDesc = { action: "create", new: { foo: "bar" } };
    expect(isTopologyDriftChange(change)).toBe(false);
  });

  test("negative: delete action", () => {
    const change: ChangeDesc = { action: "delete", old: { foo: "bar" } };
    expect(isTopologyDriftChange(change)).toBe(false);
  });

  test("negative: skip action", () => {
    const change: ChangeDesc = { action: "skip", remote: 0 };
    expect(isTopologyDriftChange(change)).toBe(false);
  });

  test("negative: missing old", () => {
    const change: ChangeDesc = { action: "update", new: { foo: "bar" } };
    expect(isTopologyDriftChange(change)).toBe(false);
  });

  test("negative: missing new", () => {
    const change: ChangeDesc = { action: "update", old: { foo: "bar" } };
    expect(isTopologyDriftChange(change)).toBe(false);
  });

  test("negative: both missing", () => {
    const change: ChangeDesc = { action: "update" };
    expect(isTopologyDriftChange(change)).toBe(false);
  });
});

describe("isReclassifiedListElementDriftChange (dagshund-15yh)", () => {
  const change: ChangeDesc = { action: "update", remote: { task_key: "ingest" } };
  const baseCtx = {
    changeKey: "tasks[task_key='publish'].depends_on[task_key='ingest']",
    newState: {
      value: { tasks: [{ task_key: "publish", depends_on: [{ task_key: "transform" }] }] },
    },
    remoteState: { tasks: [{ task_key: "publish", depends_on: [{ task_key: "ingest" }] }] },
  };

  test("true when shape matches and resourceHasShapeDrift gates it", () => {
    expect(
      isReclassifiedListElementDriftChange(change, { ...baseCtx, resourceHasShapeDrift: true }),
    ).toBe(true);
  });

  test("false when resourceHasShapeDrift is false (gate closed)", () => {
    expect(
      isReclassifiedListElementDriftChange(change, { ...baseCtx, resourceHasShapeDrift: false }),
    ).toBe(false);
  });

  test("false when change has old (not the reclassified shape)", () => {
    const c: ChangeDesc = { action: "update", old: "x", remote: "y" };
    expect(
      isReclassifiedListElementDriftChange(c, { ...baseCtx, resourceHasShapeDrift: true }),
    ).toBe(false);
  });

  test("false when change is a list-element create, not delete", () => {
    const c: ChangeDesc = { action: "update", remote: { task_key: "transform" } };
    const ctx = {
      changeKey: "tasks[task_key='publish'].depends_on[task_key='transform']",
      newState: {
        value: { tasks: [{ task_key: "publish", depends_on: [{ task_key: "transform" }] }] },
      },
      remoteState: { tasks: [{ task_key: "publish", depends_on: [] }] },
      resourceHasShapeDrift: true,
    };
    expect(isReclassifiedListElementDriftChange(c, ctx)).toBe(false);
  });
});

describe("hasAnyDriftWithContext / hasTaskDriftWithContext (dagshund-15yh)", () => {
  // A reclassified-list-element-delete change: only `remote` present, no old/new.
  const reclassifiedDelete: ChangeDesc = { action: "update", remote: { task_key: "ingest" } };
  const reclassifiedKey = "tasks[task_key='publish'].depends_on[task_key='ingest']";

  // A shape-based field-drift change: old == new but remote differs.
  const fieldDrift: ChangeDesc = {
    action: "update",
    old: "UI_LOCKED",
    new: "UI_LOCKED",
    remote: "EDITABLE",
  };

  const driftParent = {
    newState: {
      value: { tasks: [{ task_key: "publish", depends_on: [{ task_key: "transform" }] }] },
    },
    remoteState: { tasks: [{ task_key: "publish", depends_on: [{ task_key: "ingest" }] }] },
    resourceHasShapeDrift: true,
  };

  test("hasAnyDriftWithContext detects reclassified-delete when shape-drift present", () => {
    expect(hasAnyDriftWithContext({ [reclassifiedKey]: reclassifiedDelete }, driftParent)).toBe(
      true,
    );
  });

  test("hasAnyDriftWithContext returns false when resourceHasShapeDrift is false", () => {
    expect(
      hasAnyDriftWithContext(
        { [reclassifiedKey]: reclassifiedDelete },
        { ...driftParent, resourceHasShapeDrift: false },
      ),
    ).toBe(false);
  });

  test("hasAnyDriftWithContext still detects shape-based drift (no regression)", () => {
    expect(hasAnyDriftWithContext({ edit_mode: fieldDrift }, driftParent)).toBe(true);
  });

  test("hasTaskDriftWithContext scopes ctx-based drift to a single task_key", () => {
    // `publish` task carries the reclassified-delete; `other` task carries
    // unrelated field drift. Looking up `other` must NOT see the publish-side
    // reclassified entry (and vice versa for the field-drift on other).
    const changes = {
      [reclassifiedKey]: reclassifiedDelete,
      "tasks[task_key='other'].edit_mode": fieldDrift,
    };
    expect(hasTaskDriftWithContext("publish", changes, driftParent)).toBe(true);
    expect(hasTaskDriftWithContext("other", changes, driftParent)).toBe(true);
    // Lookup of a task with no scoped changes returns false even when other
    // tasks in the map are drifty — proves scoping, not bleed.
    expect(hasTaskDriftWithContext("nonexistent", changes, driftParent)).toBe(false);
    // Gate-closed case: same publish-only changes but resourceHasShapeDrift=false.
    expect(
      hasTaskDriftWithContext(
        "publish",
        { [reclassifiedKey]: reclassifiedDelete },
        { ...driftParent, resourceHasShapeDrift: false },
      ),
    ).toBe(false);
  });
});
