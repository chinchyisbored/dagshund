import { describe, expect, test } from "bun:test";
import {
  extractRelativeChangePath,
  matchesAllFilters,
  parseBracketFilters,
  parseDictKeyBracket,
  stripChangedFields,
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

  test("parses multiple bracket filters in one segment", () => {
    expect(parseBracketFilters("[group_name='users'][level='CAN_VIEW']")).toEqual([
      { field: "group_name", value: "users" },
      { field: "level", value: "CAN_VIEW" },
    ]);
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

  test("rejects when one of multiple filters fails", () => {
    expect(
      matchesAllFilters({ group_name: "users", level: "CAN_MANAGE" }, [
        { field: "group_name", value: "users" },
        { field: "level", value: "CAN_VIEW" },
      ]),
    ).toBe(false);
  });

  test("matches when all of multiple filters pass", () => {
    expect(
      matchesAllFilters({ group_name: "users", level: "CAN_VIEW" }, [
        { field: "group_name", value: "users" },
        { field: "level", value: "CAN_VIEW" },
      ]),
    ).toBe(true);
  });

  test("coerces missing field to 'undefined' string", () => {
    expect(matchesAllFilters({ other: "val" }, [{ field: "missing", value: "undefined" }])).toBe(
      true,
    );
    expect(matchesAllFilters({ other: "val" }, [{ field: "missing", value: "x" }])).toBe(false);
  });

  test("returns true for empty filters array (vacuous truth)", () => {
    expect(matchesAllFilters({ any: "thing" }, [])).toBe(true);
  });
});

describe("stripChangedFields", () => {
  test("returns primitives unchanged", () => {
    expect(stripChangedFields(null, ["[0]"])).toBeNull();
    expect(stripChangedFields(42, ["[0]"])).toBe(42);
    expect(stripChangedFields("hello", ["[0]"])).toBe("hello");
  });

  test("strips changed fields from array elements", () => {
    const arr = [
      { task_key: "a", other: "keep" },
      { task_key: "b", other: "keep" },
    ];

    const result = stripChangedFields(arr, ["[0].other"]);

    expect(result).toEqual([{ task_key: "a" }, { task_key: "b", other: "keep" }]);
  });

  test("strips all targeted fields from array element including identity-like keys", () => {
    const arr = [
      { job_cluster_key: "raw", new_cluster: { num_workers: 2, spark_version: "18.1" } },
    ];

    const result = stripChangedFields(arr, ["[0].job_cluster_key", "[0].new_cluster.num_workers"]);

    expect(result).toEqual([{ new_cluster: { spark_version: "18.1" } }]);
  });

  test("removes array element entirely when stripping leaves it empty", () => {
    const arr = [{ whl: "/path/to/lib.whl" }];

    const result = stripChangedFields(arr, ["[0].whl"]);

    expect(result).toEqual([]);
  });

  test("removes whole element when path has no sub-fields", () => {
    const arr = [{ task_key: "a" }, { task_key: "b" }];

    const result = stripChangedFields(arr, ["[0]"]);

    expect(result).toEqual([{ task_key: "b" }]);
  });

  test("deduplicates when multiple paths reference same index", () => {
    const arr = [{ task_key: "a", outcome: "x", other: "keep" }, { task_key: "b" }];

    const result = stripChangedFields(arr, ["[0].outcome", "[0].other"]);

    expect(result).toEqual([{ task_key: "a" }, { task_key: "b" }]);
  });

  test("strips fields from element matched by named bracket filter", () => {
    const arr = [
      { group_name: "users", level: "CAN_VIEW", extra: "keep" },
      { group_name: "admins", level: "CAN_MANAGE" },
    ];

    const result = stripChangedFields(arr, ["[group_name='users'].level"]);

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

    const result = stripChangedFields(arr, ["[group_name='users']"]);

    expect(result).toEqual([{ group_name: "admins", level: "CAN_MANAGE" }]);
  });

  test("handles combined whole-element removal and field stripping on different indices", () => {
    const arr = [
      { id: "a", name: "x" },
      { id: "b", name: "keep-b" },
      { id: "c", name: "strip-me" },
    ];

    const result = stripChangedFields(arr, ["[0]", "[2].name"]);

    expect(result).toEqual([{ id: "b", name: "keep-b" }, { id: "c" }]);
  });

  test("returns array unchanged when no paths match", () => {
    const arr = [{ task_key: "a" }];

    const result = stripChangedFields(arr, ["['environment']"]);

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

    const result = stripChangedFields(obj, ["permissions[group_name='users'].level"]);

    expect(result).toEqual({
      permissions: [{ group_name: "users" }, { group_name: "admins", level: "CAN_MANAGE" }],
      object_id: "123",
    });
  });

  test("returns plain object unchanged when bracket filters do not match", () => {
    const obj = { items: [{ name: "a" }] };

    const result = stripChangedFields(obj, ["items[name='z'].field"]);

    expect(result).toEqual({ items: [{ name: "a" }] });
  });

  test("returns empty array unchanged", () => {
    const arr: unknown[] = [];
    expect(stripChangedFields(arr, ["[0]"])).toEqual([]);
  });

  test("handles malformed bracket syntax gracefully", () => {
    const arr = [{ id: "a" }];

    const result = stripChangedFields(arr, ["[", "no-bracket", "[bad"]);

    expect(result).toBe(arr);
  });

  test("strips field via dot-then-bracket traversal through nested objects", () => {
    const obj = {
      task: {
        items: [
          { id: "a", value: "strip-me" },
          { id: "b", value: "keep" },
        ],
        other: "keep",
      },
    };

    const result = stripChangedFields(obj, ["task.items[0].value"]);

    expect(result).toEqual({
      task: {
        items: [{ id: "a" }, { id: "b", value: "keep" }],
        other: "keep",
      },
    });
  });

  test("strips field via pure dotted path on nested record", () => {
    const obj = { task: { concurrency: 20, inputs: "keep" } };

    const result = stripChangedFields(obj, ["task.concurrency"]);

    expect(result).toEqual({ task: { inputs: "keep" } });
  });

  test("strips field through multiple nesting levels", () => {
    const obj = { a: { b: { c: [{ id: "x", rm: "y" }] } } };

    const result = stripChangedFields(obj, ["a.b.c[0].rm"]);

    expect(result).toEqual({ a: { b: { c: [{ id: "x" }] } } });
  });

  test("strips mixed direct and nested paths on same record", () => {
    const obj = {
      concurrency: 20,
      task: {
        items: [
          { id: "a", value: "strip" },
          { id: "b", value: "keep" },
        ],
        other: "keep",
      },
    };

    const result = stripChangedFields(obj, ["concurrency", "task.items[0].value"]);

    expect(result).toEqual({
      task: {
        items: [{ id: "a" }, { id: "b", value: "keep" }],
        other: "keep",
      },
    });
  });

  test("preserves non-traversable intermediate values unchanged", () => {
    const obj = { a: "string-value", b: "keep" };

    const result = stripChangedFields(obj, ["a.b"]);

    expect(result).toEqual({ a: "string-value", b: "keep" });
  });

  test("strips field via dict-key bracket on record", () => {
    const obj = {
      base_parameters: { sample_size: "100", other: "keep" },
    };

    const result = stripChangedFields(obj, ["base_parameters['sample_size']"]);

    expect(result).toEqual({
      base_parameters: { other: "keep" },
    });
  });

  test("strips field via dict-key bracket after dot traversal", () => {
    const obj = {
      notebook_task: { base_parameters: { sample_size: "100", other: "keep" } },
    };

    const result = stripChangedFields(obj, ["notebook_task.base_parameters['sample_size']"]);

    expect(result).toEqual({
      notebook_task: { base_parameters: { other: "keep" } },
    });
  });

  test("strips field via dict-key bracket in array element sub-path", () => {
    const arr = [{ params: { sample_size: "100", other: "keep" } }];

    const result = stripChangedFields(arr, ["[0].params['sample_size']"]);

    expect(result).toEqual([{ params: { other: "keep" } }]);
  });

  test("preserves primitive target when dict-key bracket cannot traverse", () => {
    const obj = { props: "just-a-string" };

    const result = stripChangedFields(obj, ["props['key']"]);

    expect(result).toEqual({ props: "just-a-string" });
  });

  test("strips field through multiple consecutive dict-key brackets", () => {
    const obj = { config: { section: { key: "val", other: "keep" } } };

    const result = stripChangedFields(obj, ["config['section']['key']"]);

    expect(result).toEqual({ config: { section: { other: "keep" } } });
  });
});

describe("parseDictKeyBracket", () => {
  test("parses valid dict-key bracket", () => {
    expect(parseDictKeyBracket("['sample_size']")).toEqual({
      key: "sample_size",
      rest: "",
    });
  });

  test("parses dict-key bracket with remaining dot path", () => {
    expect(parseDictKeyBracket("['sample_size'].more")).toEqual({
      key: "sample_size",
      rest: "more",
    });
  });

  test("returns undefined for numeric index", () => {
    expect(parseDictKeyBracket("[0].whl")).toBeUndefined();
  });

  test("returns undefined for named filter bracket", () => {
    expect(parseDictKeyBracket("[group_name='users']")).toBeUndefined();
  });
});
