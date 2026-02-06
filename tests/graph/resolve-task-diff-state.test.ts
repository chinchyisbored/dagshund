import { describe, test, expect } from "bun:test";
import { resolveTaskDiffState } from "../../src/graph/resolve-task-diff-state.ts";

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
});
