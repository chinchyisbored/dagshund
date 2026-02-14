import { describe, expect, test } from "bun:test";
import { buildTaskChangeSummary } from "../../src/graph/build-task-change-summary.ts";
import type { TaskEntry } from "../../src/graph/extract-tasks.ts";
import type { ActionType, ChangeDesc } from "../../src/types/plan-schema.ts";

const makeTask = (taskKey: string): TaskEntry => ({ task_key: taskKey });

const makeChange = (action: ActionType, old?: unknown, newVal?: unknown): ChangeDesc => ({
  action,
  ...(old !== undefined ? { old } : {}),
  ...(newVal !== undefined ? { new: newVal } : {}),
});

describe("buildTaskChangeSummary", () => {
  test("returns undefined for created resource (all tasks inherit added)", () => {
    const tasks = [makeTask("extract"), makeTask("transform")];
    const result = buildTaskChangeSummary(tasks, "create", undefined);
    expect(result).toBeUndefined();
  });

  test("returns undefined for deleted resource (all tasks inherit removed)", () => {
    const tasks = [makeTask("extract")];
    const result = buildTaskChangeSummary(tasks, "delete", undefined);
    expect(result).toBeUndefined();
  });

  test("returns undefined when no tasks exist", () => {
    const result = buildTaskChangeSummary([], "update", undefined);
    expect(result).toBeUndefined();
  });

  test("returns undefined when all tasks are unchanged", () => {
    const tasks = [makeTask("extract"), makeTask("transform")];
    const result = buildTaskChangeSummary(tasks, "update", undefined);
    expect(result).toBeUndefined();
  });

  test("returns undefined when changes only contain skip actions", () => {
    const tasks = [makeTask("extract")];
    const changes = {
      "tasks[task_key='extract'].notebook_task": makeChange("skip"),
    };
    const result = buildTaskChangeSummary(tasks, "update", changes);
    expect(result).toBeUndefined();
  });

  test("detects added tasks", () => {
    const tasks = [makeTask("extract"), makeTask("new_task")];
    const changes: Record<string, ChangeDesc> = {
      "tasks[task_key='new_task']": makeChange("create", undefined, { task_key: "new_task" }),
    };
    const result = buildTaskChangeSummary(tasks, "update", changes);
    expect(result).toHaveLength(1);
    expect(result?.[0]).toEqual({ taskKey: "new_task", diffState: "added" });
  });

  test("detects removed tasks from changes record (not in new_state)", () => {
    const tasks = [makeTask("extract")];
    const changes: Record<string, ChangeDesc> = {
      "tasks[task_key='old_task']": makeChange("delete", { task_key: "old_task" }, undefined),
    };
    const result = buildTaskChangeSummary(tasks, "update", changes);
    expect(result).toHaveLength(1);
    expect(result?.[0]).toEqual({ taskKey: "old_task", diffState: "removed" });
  });

  test("detects modified tasks", () => {
    const tasks = [makeTask("transform")];
    const changes: Record<string, ChangeDesc> = {
      "tasks[task_key='transform'].notebook_task.notebook_path": makeChange(
        "update",
        "/old/path",
        "/new/path",
      ),
    };
    const result = buildTaskChangeSummary(tasks, "update", changes);
    expect(result).toHaveLength(1);
    expect(result?.[0]).toEqual({ taskKey: "transform", diffState: "modified" });
  });

  test("sorts by diff state order: added → removed → modified", () => {
    const tasks = [makeTask("alpha"), makeTask("beta")];
    const changes: Record<string, ChangeDesc> = {
      "tasks[task_key='zeta']": makeChange("delete", { task_key: "zeta" }, undefined),
      "tasks[task_key='beta'].notebook_task": makeChange("update", "/old", "/new"),
      "tasks[task_key='alpha']": makeChange("create", undefined, { task_key: "alpha" }),
    };
    const result = buildTaskChangeSummary(tasks, "update", changes);
    expect(result).toHaveLength(3);
    expect(result?.[0]?.diffState).toBe("added");
    expect(result?.[1]?.diffState).toBe("removed");
    expect(result?.[2]?.diffState).toBe("modified");
  });

  test("sorts alphabetically within same diff state", () => {
    const tasks = [makeTask("charlie"), makeTask("alpha"), makeTask("bravo")];
    const changes: Record<string, ChangeDesc> = {
      "tasks[task_key='charlie'].x": makeChange("update", 1, 2),
      "tasks[task_key='alpha'].x": makeChange("update", 1, 2),
      "tasks[task_key='bravo'].x": makeChange("update", 1, 2),
    };
    const result = buildTaskChangeSummary(tasks, "update", changes);
    expect(result).toHaveLength(3);
    expect(result?.map((e) => e.taskKey)).toEqual(["alpha", "bravo", "charlie"]);
  });

  test("handles mix of added, removed, modified, and unchanged tasks", () => {
    const tasks = [makeTask("extract"), makeTask("transform"), makeTask("new_step")];
    const changes: Record<string, ChangeDesc> = {
      "tasks[task_key='new_step']": makeChange("create", undefined, { task_key: "new_step" }),
      "tasks[task_key='transform'].notebook_task": makeChange("update", "/old", "/new"),
      "tasks[task_key='removed_step']": makeChange(
        "delete",
        { task_key: "removed_step" },
        undefined,
      ),
    };
    const result = buildTaskChangeSummary(tasks, "update", changes);
    expect(result).toHaveLength(3);
    // added first, then removed, then modified
    expect(result?.[0]).toEqual({ taskKey: "new_step", diffState: "added" });
    expect(result?.[1]).toEqual({ taskKey: "removed_step", diffState: "removed" });
    expect(result?.[2]).toEqual({ taskKey: "transform", diffState: "modified" });
  });

  test("works with undefined action (unchanged resource)", () => {
    const tasks = [makeTask("extract")];
    const changes: Record<string, ChangeDesc> = {
      "tasks[task_key='extract'].x": makeChange("update", 1, 2),
    };
    const result = buildTaskChangeSummary(tasks, undefined, changes);
    expect(result).toHaveLength(1);
    expect(result?.[0]).toEqual({ taskKey: "extract", diffState: "modified" });
  });
});
