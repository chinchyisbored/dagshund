import { describe, expect, test } from "bun:test";
import {
  extractRelativeChangePath,
  matchesAllFilters,
  parseBracketFilters,
  stripChangedArrayEntries,
  topLevelFieldName,
} from "../../src/utils/change-path.ts";

describe("topLevelFieldName", () => {
  test("splits at dot for simple dotted paths", () => {
    expect(topLevelFieldName("notebook_task.notebook_path")).toBe("notebook_task");
  });

  test("returns whole string when no separator", () => {
    expect(topLevelFieldName("timeout_seconds")).toBe("timeout_seconds");
  });

  test("splits at bracket for numeric array index before dot", () => {
    expect(topLevelFieldName("depends_on[0].task_key")).toBe("depends_on");
  });

  test("splits at bracket for named bracket before dot", () => {
    expect(topLevelFieldName("permissions[group_name='users'].permission_level")).toBe(
      "permissions",
    );
  });

  test("splits at bracket when no dot follows", () => {
    expect(topLevelFieldName("permissions[group_name='users']")).toBe("permissions");
  });

  test("splits at bracket for dict key bracket with no dot", () => {
    expect(topLevelFieldName("properties['environment']")).toBe("properties");
  });

  test("splits at dot when dot comes before bracket", () => {
    expect(topLevelFieldName("notebook_task.base_parameters['sample_size']")).toBe("notebook_task");
  });

  test("strips task prefix before splitting", () => {
    expect(topLevelFieldName("tasks[task_key='combine'].depends_on[0].task_key")).toBe(
      "depends_on",
    );
  });

  test("handles job_clusters numeric index", () => {
    expect(topLevelFieldName("job_clusters[0].job_cluster_key")).toBe("job_clusters");
  });
});

describe("extractRelativeChangePath", () => {
  test("returns remainder after dot for simple paths", () => {
    expect(extractRelativeChangePath("notebook_task.notebook_path")).toBe("notebook_path");
  });

  test("returns undefined when no separator", () => {
    expect(extractRelativeChangePath("timeout_seconds")).toBeUndefined();
  });

  test("preserves bracket for numeric index before dot", () => {
    expect(extractRelativeChangePath("depends_on[0].task_key")).toBe("[0].task_key");
  });

  test("preserves bracket for named bracket before dot", () => {
    expect(extractRelativeChangePath("permissions[group_name='users'].permission_level")).toBe(
      "[group_name='users'].permission_level",
    );
  });

  test("preserves bracket when no dot follows", () => {
    expect(extractRelativeChangePath("permissions[group_name='users']")).toBe(
      "[group_name='users']",
    );
  });

  test("preserves bracket for dict key access", () => {
    expect(extractRelativeChangePath("properties['environment']")).toBe("['environment']");
  });

  test("returns after dot when dot comes before bracket", () => {
    expect(extractRelativeChangePath("notebook_task.base_parameters['sample_size']")).toBe(
      "base_parameters['sample_size']",
    );
  });

  test("strips task prefix before splitting", () => {
    expect(extractRelativeChangePath("tasks[task_key='combine'].depends_on[0].task_key")).toBe(
      "[0].task_key",
    );
  });
});

describe("parseBracketFilters", () => {
  test("parses named bracket filter", () => {
    expect(parseBracketFilters("permissions[group_name='users']")).toEqual([
      { field: "group_name", value: "users" },
    ]);
  });

  test("returns empty for numeric index", () => {
    expect(parseBracketFilters("[0]")).toEqual([]);
  });

  test("returns empty for dict key bracket", () => {
    expect(parseBracketFilters("['environment']")).toEqual([]);
  });

  test("returns empty for no brackets", () => {
    expect(parseBracketFilters("notebook_task")).toEqual([]);
  });
});

describe("matchesAllFilters", () => {
  test("matches when all filters match", () => {
    expect(
      matchesAllFilters({ group_name: "users" }, [{ field: "group_name", value: "users" }]),
    ).toBe(true);
  });

  test("rejects when filter does not match", () => {
    expect(
      matchesAllFilters({ group_name: "admins" }, [{ field: "group_name", value: "users" }]),
    ).toBe(false);
  });

  test("rejects non-objects", () => {
    expect(matchesAllFilters(null, [{ field: "x", value: "y" }])).toBe(false);
    expect(matchesAllFilters("string", [{ field: "x", value: "y" }])).toBe(false);
  });
});

describe("stripChangedArrayEntries", () => {
  test("returns primitives unchanged", () => {
    expect(stripChangedArrayEntries(null, ["[0]"])).toBeNull();
    expect(stripChangedArrayEntries(42, ["[0]"])).toBe(42);
    expect(stripChangedArrayEntries("hello", ["[0]"])).toBe("hello");
  });

  test("strips only changed fields from array elements, preserving identity key", () => {
    const arr = [
      { task_key: "a", other: "keep" },
      { task_key: "b", other: "keep" },
    ];

    const result = stripChangedArrayEntries(arr, ["[0].other"]);

    expect(result).toEqual([{ task_key: "a" }, { task_key: "b", other: "keep" }]);
  });

  test("preserves identity key even when it appears in changed fields", () => {
    const arr = [
      { job_cluster_key: "raw", new_cluster: { num_workers: 2, spark_version: "18.1" } },
    ];

    const result = stripChangedArrayEntries(arr, [
      "[0].job_cluster_key",
      "[0].new_cluster.num_workers",
    ]);

    expect(result).toEqual([{ job_cluster_key: "raw", new_cluster: { spark_version: "18.1" } }]);
  });

  test("removes whole element when path has no sub-fields", () => {
    const arr = [{ task_key: "a" }, { task_key: "b" }];

    const result = stripChangedArrayEntries(arr, ["[0]"]);

    expect(result).toEqual([{ task_key: "b" }]);
  });

  test("deduplicates when multiple paths reference same index", () => {
    const arr = [{ task_key: "a", outcome: "x", other: "keep" }, { task_key: "b" }];

    const result = stripChangedArrayEntries(arr, ["[0].outcome", "[0].other"]);

    expect(result).toEqual([{ task_key: "a" }, { task_key: "b" }]);
  });

  test("strips fields from element matched by named bracket filter", () => {
    const arr = [
      { group_name: "users", level: "CAN_VIEW", extra: "keep" },
      { group_name: "admins", level: "CAN_MANAGE" },
    ];

    const result = stripChangedArrayEntries(arr, ["[group_name='users'].level"]);

    expect(result).toEqual([
      { group_name: "users", extra: "keep" },
      { group_name: "admins", level: "CAN_MANAGE" },
    ]);
  });

  test("removes whole element by named bracket filter when no sub-path", () => {
    const arr = [
      { group_name: "users", level: "CAN_VIEW" },
      { group_name: "admins", level: "CAN_MANAGE" },
    ];

    const result = stripChangedArrayEntries(arr, ["[group_name='users']"]);

    expect(result).toEqual([{ group_name: "admins", level: "CAN_MANAGE" }]);
  });

  test("handles combined whole-element removal and field stripping on different indices", () => {
    const arr = [
      { id: "a", name: "x" },
      { id: "b", name: "keep-b" },
      { id: "c", name: "strip-me" },
    ];

    const result = stripChangedArrayEntries(arr, ["[0]", "[2].name"]);

    expect(result).toEqual([{ id: "b", name: "keep-b" }, { id: "c" }]);
  });

  test("returns array unchanged when no paths match", () => {
    const arr = [{ task_key: "a" }];

    const result = stripChangedArrayEntries(arr, ["['environment']"]);

    expect(result).toBe(arr);
  });

  test("strips nested array entries from plain object", () => {
    const obj = {
      permissions: [
        { group_name: "users", level: "CAN_VIEW" },
        { group_name: "admins", level: "CAN_MANAGE" },
      ],
      object_id: "123",
    };

    const result = stripChangedArrayEntries(obj, ["permissions[group_name='users'].level"]);

    expect(result).toEqual({
      permissions: [{ group_name: "users" }, { group_name: "admins", level: "CAN_MANAGE" }],
      object_id: "123",
    });
  });

  test("returns plain object unchanged when bracket filters do not match", () => {
    const obj = { items: [{ name: "a" }] };

    const result = stripChangedArrayEntries(obj, ["items[name='z'].field"]);

    expect(result).toEqual({ items: [{ name: "a" }] });
  });

  test("handles malformed bracket syntax gracefully", () => {
    const arr = [{ id: "a" }];

    const result = stripChangedArrayEntries(arr, ["[", "no-bracket", "[bad"]);

    expect(result).toBe(arr);
  });
});
