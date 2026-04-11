import { describe, expect, test } from "bun:test";
import { classifyChange, resolveTaskDiffState } from "../../src/graph/resolve-task-diff-state.ts";
import type { ChangeDesc } from "../../src/types/plan-schema.ts";

describe("classifyChange", () => {
  const make = (fields: Partial<ChangeDesc>): ChangeDesc => ({
    action: "update" as const,
    ...fields,
  });

  test("returns 'added' when new is present and old is absent", () => {
    expect(classifyChange(make({ new: { task_key: "x" } }))).toBe("added");
  });

  test("returns 'removed' when old is present and new is absent", () => {
    expect(classifyChange(make({ old: { task_key: "x" } }))).toBe("removed");
  });

  test("returns 'modified' when both old and new are present", () => {
    expect(classifyChange(make({ old: "a", new: "b" }))).toBe("modified");
  });

  test("returns undefined when neither old nor new is present", () => {
    expect(classifyChange(make({}))).toBeUndefined();
  });

  test("returns 'added' for topology drift (old == new, no remote)", () => {
    // Drift-re-entry: identical bundle definition, missing from remote.
    // Apply will create it, so it's an addition from the remote's perspective.
    const task = { task_key: "transform", notebook_task: { notebook_path: "/x" } };
    expect(classifyChange(make({ old: task, new: task }))).toBe("added");
  });
});

describe("resolveTaskDiffState", () => {
  test("returns 'added' when resource action is create", () => {
    expect(resolveTaskDiffState("extract", "create", undefined)).toBe("added");
  });

  test("returns 'removed' when resource action is delete", () => {
    expect(resolveTaskDiffState("extract", "delete", undefined)).toBe("removed");
  });

  test("returns 'unchanged' when no changes exist for task", () => {
    expect(resolveTaskDiffState("extract", "update", {})).toBe("unchanged");
  });

  test("returns 'unchanged' when all task changes are skips", () => {
    const changes = {
      "tasks[task_key='extract'].email_notifications": {
        action: "skip" as const,
        reason: "empty_struct",
        remote: {},
      },
      "tasks[task_key='extract'].timeout_seconds": {
        action: "skip" as const,
        reason: "server_side_default",
        remote: 0,
      },
    };
    expect(resolveTaskDiffState("extract", "update", changes)).toBe("unchanged");
  });

  test("returns 'added' for whole-task change with only new field", () => {
    const changes = {
      "tasks[task_key='aggregate']": {
        action: "update" as const,
        new: { task_key: "aggregate", notebook_task: {} },
      },
    };
    expect(resolveTaskDiffState("aggregate", "update", changes)).toBe("added");
  });

  test("returns 'removed' for whole-task change with only old field", () => {
    const changes = {
      "tasks[task_key='validate']": {
        action: "update" as const,
        old: { task_key: "validate", notebook_task: {} },
        remote: { task_key: "validate" },
      },
    };
    expect(resolveTaskDiffState("validate", "update", changes)).toBe("removed");
  });

  test("returns 'modified' for sub-field update", () => {
    const changes = {
      "tasks[task_key='transform'].notebook_task.notebook_path": {
        action: "update" as const,
        old: "/Workspace/etl/transform",
        new: "/Workspace/etl/transform_v2",
        remote: "/Workspace/etl/transform",
      },
      "tasks[task_key='transform'].email_notifications": {
        action: "skip" as const,
        reason: "empty_struct",
        remote: {},
      },
    };
    expect(resolveTaskDiffState("transform", "update", changes)).toBe("modified");
  });

  test("returns 'unchanged' when resource action is undefined and no changes", () => {
    expect(resolveTaskDiffState("extract", undefined, undefined)).toBe("unchanged");
  });

  test("returns 'added' for topology-drift whole-task entry (re-added on apply)", () => {
    // old == new, no `remote` — indicates the task is missing from the remote.
    // Databricks will recreate it on apply, so from the remote's perspective
    // this is an addition. The `isDrift` flag (set separately by the builders)
    // carries the "this is drift, not a brand-new user addition" context.
    const changes = {
      "tasks[task_key='transform']": {
        action: "update" as const,
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
      },
    };
    expect(resolveTaskDiffState("transform", "update", changes)).toBe("added");
  });
});
