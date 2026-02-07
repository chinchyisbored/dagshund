import { describe, expect, test } from "bun:test";
import type { ChangeDesc } from "../../src/types/plan-schema.ts";
import {
  computeStructuralDiff,
  diffArrays,
  diffObjects,
  findIdentityKey,
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
    const items = [
      { task_key: "extract" },
      { task_key: "transform" },
      { task_key: "load" },
    ];
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

  test("detects changed keys", () => {
    const result = diffObjects({ a: 1 }, { a: 2 });
    const changed = result.entries.find((e) => e.key === "a");
    expect(changed?.status).toBe("changed");
    expect(changed?.old).toBe(1);
    expect(changed?.new).toBe(2);
  });

  test("detects unchanged keys", () => {
    const result = diffObjects({ a: 1 }, { a: 1 });
    expect(result.entries[0]?.status).toBe("unchanged");
  });

  test("sorts entries: changed → added → removed → unchanged", () => {
    const result = diffObjects(
      { unchanged: 1, removed: 2, changed: "old" },
      { unchanged: 1, added: 3, changed: "new" },
    );
    const statuses = result.entries.map((e) => e.status);
    expect(statuses).toEqual(["changed", "added", "removed", "unchanged"]);
  });

  test("handles empty objects", () => {
    expect(diffObjects({}, {}).entries).toHaveLength(0);
  });

  test("deep-compares nested values", () => {
    const result = diffObjects(
      { nested: { a: 1 } },
      { nested: { a: 1 } },
    );
    expect(result.entries[0]?.status).toBe("unchanged");

    const changed = diffObjects(
      { nested: { a: 1 } },
      { nested: { a: 2 } },
    );
    expect(changed.entries[0]?.status).toBe("changed");
  });

  test("treats objects with different key ordering as unchanged", () => {
    const result = diffObjects(
      { config: { b: 2, a: 1 } },
      { config: { a: 1, b: 2 } },
    );
    expect(result.entries[0]?.status).toBe("unchanged");
  });
});

describe("computeStructuralDiff", () => {
  test("create-only when action is create with no baseline", () => {
    const change: ChangeDesc = { action: "create", new: "hello" };
    const result = computeStructuralDiff(change);
    expect(result.diff.kind).toBe("create-only");
    if (result.diff.kind === "create-only") {
      expect(result.diff.value).toBe("hello");
    }
    expect(result.baselineLabel).toBe("old");
  });

  test("delete-only when action is delete with no new", () => {
    const change: ChangeDesc = { action: "delete", old: "goodbye" };
    const result = computeStructuralDiff(change);
    expect(result.diff.kind).toBe("delete-only");
    if (result.diff.kind === "delete-only") {
      expect(result.diff.value).toBe("goodbye");
    }
    expect(result.baselineLabel).toBe("old");
  });

  test("scalar diff for primitive values", () => {
    const change: ChangeDesc = { action: "update", old: "before", new: "after" };
    const result = computeStructuralDiff(change);
    expect(result.diff.kind).toBe("scalar");
    if (result.diff.kind === "scalar") {
      expect(result.diff.old).toBe("before");
      expect(result.diff.new).toBe("after");
    }
    expect(result.baselineLabel).toBe("old");
  });

  test("scalar diff for number values", () => {
    const change: ChangeDesc = { action: "update", old: 1, new: 2 };
    const result = computeStructuralDiff(change);
    expect(result.diff.kind).toBe("scalar");
  });

  test("scalar diff for boolean values", () => {
    const change: ChangeDesc = { action: "update", old: true, new: false };
    const result = computeStructuralDiff(change);
    expect(result.diff.kind).toBe("scalar");
  });

  test("array diff when both values are arrays", () => {
    const change: ChangeDesc = {
      action: "update",
      old: [{ task_key: "a" }],
      new: [{ task_key: "a" }, { task_key: "b" }],
    };
    const result = computeStructuralDiff(change);
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
    const result = computeStructuralDiff(change);
    expect(result.diff.kind).toBe("object");
    if (result.diff.kind === "object") {
      expect(result.diff.entries).toHaveLength(2);
    }
  });

  test("scalar diff when types mismatch (array vs object)", () => {
    const change: ChangeDesc = { action: "update", old: [1], new: { a: 1 } };
    const result = computeStructuralDiff(change);
    expect(result.diff.kind).toBe("scalar");
  });

  test("remote fallback when old is missing", () => {
    const change: ChangeDesc = {
      action: "update",
      remote: [{ task_key: "a" }],
      new: [{ task_key: "a" }, { task_key: "b" }],
    };
    const result = computeStructuralDiff(change);
    expect(result.baselineLabel).toBe("remote");
    expect(result.diff.kind).toBe("array");
  });

  test("prefers old over remote when both exist", () => {
    const change: ChangeDesc = {
      action: "update",
      old: "from-old",
      remote: "from-remote",
      new: "to-new",
    };
    const result = computeStructuralDiff(change);
    expect(result.baselineLabel).toBe("old");
    if (result.diff.kind === "scalar") {
      expect(result.diff.old).toBe("from-old");
    }
  });

  test("create-only when no baseline and action is not create", () => {
    const change: ChangeDesc = { action: "update", new: "value" };
    const result = computeStructuralDiff(change);
    expect(result.diff.kind).toBe("create-only");
  });

  test("delete-only for remote-only baseline on delete", () => {
    const change: ChangeDesc = { action: "delete", remote: "remote-val" };
    const result = computeStructuralDiff(change);
    expect(result.diff.kind).toBe("delete-only");
    expect(result.baselineLabel).toBe("remote");
    if (result.diff.kind === "delete-only") {
      expect(result.diff.value).toBe("remote-val");
    }
  });
});
