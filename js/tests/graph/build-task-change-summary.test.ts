import { describe, expect, test } from "bun:test";
import { buildTaskChangeSummary } from "../../src/graph/build-task-change-summary.ts";
import type { TaskEntry } from "../../src/graph/extract-tasks.ts";
import type { ActionType, ChangeDesc } from "../../src/types/plan-schema.ts";
import type { DriftScanParent } from "../../src/utils/structural-diff.ts";

const makeTask = (taskKey: string): TaskEntry => ({ task_key: taskKey });

const makeChange = (action: ActionType, old?: unknown, newVal?: unknown): ChangeDesc => ({
  action,
  ...(old !== undefined ? { old } : {}),
  ...(newVal !== undefined ? { new: newVal } : {}),
});

/** Default ctx for shape-only test cases — none of the existing tests exercise
 *  the reclassified-list-element-delete path, so absent state + false flag is
 *  the equivalent of pre-15yh behavior. */
const NO_DRIFT_CTX: DriftScanParent = {
  newState: undefined,
  remoteState: undefined,
  resourceHasShapeDrift: false,
};

describe("buildTaskChangeSummary", () => {
  test("returns undefined for created resource (all tasks inherit added)", () => {
    const tasks = [makeTask("extract"), makeTask("transform")];
    const result = buildTaskChangeSummary(tasks, "create", undefined, NO_DRIFT_CTX);
    expect(result).toBeUndefined();
  });

  test("returns undefined for deleted resource (all tasks inherit removed)", () => {
    const tasks = [makeTask("extract")];
    const result = buildTaskChangeSummary(tasks, "delete", undefined, NO_DRIFT_CTX);
    expect(result).toBeUndefined();
  });

  test("returns undefined when no tasks exist", () => {
    const result = buildTaskChangeSummary([], "update", undefined, NO_DRIFT_CTX);
    expect(result).toBeUndefined();
  });

  test("returns undefined when all tasks are unchanged", () => {
    const tasks = [makeTask("extract"), makeTask("transform")];
    const result = buildTaskChangeSummary(tasks, "update", undefined, NO_DRIFT_CTX);
    expect(result).toBeUndefined();
  });

  test("returns undefined when changes only contain skip actions", () => {
    const tasks = [makeTask("extract")];
    const changes = {
      "tasks[task_key='extract'].notebook_task": makeChange("skip"),
    };
    const result = buildTaskChangeSummary(tasks, "update", changes, NO_DRIFT_CTX);
    expect(result).toBeUndefined();
  });

  test("detects added tasks", () => {
    const tasks = [makeTask("extract"), makeTask("new_task")];
    const changes: Record<string, ChangeDesc> = {
      "tasks[task_key='new_task']": makeChange("create", undefined, { task_key: "new_task" }),
    };
    const result = buildTaskChangeSummary(tasks, "update", changes, NO_DRIFT_CTX);
    expect(result).toHaveLength(1);
    expect(result?.[0]).toEqual({ taskKey: "new_task", diffState: "added", isDrift: false });
  });

  test("detects removed tasks from changes record (not in new_state)", () => {
    const tasks = [makeTask("extract")];
    const changes: Record<string, ChangeDesc> = {
      "tasks[task_key='old_task']": makeChange("delete", { task_key: "old_task" }, undefined),
    };
    const result = buildTaskChangeSummary(tasks, "update", changes, NO_DRIFT_CTX);
    expect(result).toHaveLength(1);
    expect(result?.[0]).toEqual({ taskKey: "old_task", diffState: "removed", isDrift: false });
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
    const result = buildTaskChangeSummary(tasks, "update", changes, NO_DRIFT_CTX);
    expect(result).toHaveLength(1);
    expect(result?.[0]).toEqual({ taskKey: "transform", diffState: "modified", isDrift: false });
  });

  test("sorts by diff state order: added → removed → modified", () => {
    const tasks = [makeTask("alpha"), makeTask("beta")];
    const changes: Record<string, ChangeDesc> = {
      "tasks[task_key='zeta']": makeChange("delete", { task_key: "zeta" }, undefined),
      "tasks[task_key='beta'].notebook_task": makeChange("update", "/old", "/new"),
      "tasks[task_key='alpha']": makeChange("create", undefined, { task_key: "alpha" }),
    };
    const result = buildTaskChangeSummary(tasks, "update", changes, NO_DRIFT_CTX);
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
    const result = buildTaskChangeSummary(tasks, "update", changes, NO_DRIFT_CTX);
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
    const result = buildTaskChangeSummary(tasks, "update", changes, NO_DRIFT_CTX);
    expect(result).toHaveLength(3);
    // added first, then removed, then modified
    expect(result?.[0]).toEqual({ taskKey: "new_step", diffState: "added", isDrift: false });
    expect(result?.[1]).toEqual({ taskKey: "removed_step", diffState: "removed", isDrift: false });
    expect(result?.[2]).toEqual({ taskKey: "transform", diffState: "modified", isDrift: false });
  });

  test("works with undefined action (unchanged resource)", () => {
    const tasks = [makeTask("extract")];
    const changes: Record<string, ChangeDesc> = {
      "tasks[task_key='extract'].x": makeChange("update", 1, 2),
    };
    const result = buildTaskChangeSummary(tasks, undefined, changes, NO_DRIFT_CTX);
    expect(result).toHaveLength(1);
    expect(result?.[0]).toEqual({ taskKey: "extract", diffState: "modified", isDrift: false });
  });

  test("marks field-drifted tasks with isDrift: true", () => {
    const tasks = [makeTask("publish")];
    // Field-level drift: old == new but remote diverged (server-side edit).
    const changes: Record<string, ChangeDesc> = {
      "tasks[task_key='publish'].edit_mode": {
        action: "update",
        old: "UI_LOCKED",
        new: "UI_LOCKED",
        remote: "EDITABLE",
      },
    };
    const result = buildTaskChangeSummary(tasks, "update", changes, NO_DRIFT_CTX);
    expect(result).toHaveLength(1);
    expect(result?.[0]).toEqual({ taskKey: "publish", diffState: "modified", isDrift: true });
  });

  test("marks topology-drifted tasks with isDrift: true", () => {
    const tasks = [makeTask("audit_analysis")];
    // Topology drift: whole task present in bundle but missing from remote
    // (old == new, no `remote` key). Classifies as "added" — server will create it.
    const changes: Record<string, ChangeDesc> = {
      "tasks[task_key='audit_analysis']": {
        action: "update",
        old: { task_key: "audit_analysis" },
        new: { task_key: "audit_analysis" },
      },
    };
    const result = buildTaskChangeSummary(tasks, "update", changes, NO_DRIFT_CTX);
    expect(result).toHaveLength(1);
    expect(result?.[0]).toEqual({
      taskKey: "audit_analysis",
      diffState: "added",
      isDrift: true,
    });
  });

  test("does not mark skip-action drift-shaped entries as drift", () => {
    // Regression guard: a server-side alias like `edit_mode: UI_LOCKED <-> EDITABLE`
    // can come in as action="skip" with the same shape as field drift. It must
    // NOT be classified as drift — `isFieldDriftChange` gates on action === "update".
    const tasks = [makeTask("publish")];
    const changes: Record<string, ChangeDesc> = {
      "tasks[task_key='publish'].edit_mode": {
        action: "skip",
        old: "UI_LOCKED",
        new: "UI_LOCKED",
        remote: "EDITABLE",
      },
    };
    const result = buildTaskChangeSummary(tasks, "update", changes, NO_DRIFT_CTX);
    // Filtered out entirely — skip actions are unchanged.
    expect(result).toBeUndefined();
  });
});
