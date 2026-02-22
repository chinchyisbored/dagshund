import { describe, expect, test } from "bun:test";
import type { ActionType, ChangeDesc } from "../../src/types/plan-schema.ts";
import {
  buildTaskKeyPrefix,
  collectChangesForTask,
  filterJobLevelChanges,
  TASK_KEY_DOT_PREFIX_PATTERN,
  TASK_KEY_PATTERN,
} from "../../src/utils/task-key.ts";

const makeChange = (action: ActionType): ChangeDesc => ({ action });

describe("buildTaskKeyPrefix", () => {
  test("builds the expected prefix string", () => {
    expect(buildTaskKeyPrefix("validate")).toBe("tasks[task_key='validate']");
  });

  test("preserves special characters in task key", () => {
    expect(buildTaskKeyPrefix("my-task_v2")).toBe("tasks[task_key='my-task_v2']");
  });
});

describe("TASK_KEY_PATTERN", () => {
  test("captures task key from a task entry", () => {
    const match = "tasks[task_key='extract']".match(TASK_KEY_PATTERN);
    expect(match?.[1]).toBe("extract");
  });

  test("captures task key from a dotted subpath", () => {
    const match = "tasks[task_key='validate'].notebook_task.path".match(TASK_KEY_PATTERN);
    expect(match?.[1]).toBe("validate");
  });

  test("does not match non-task keys", () => {
    expect("name".match(TASK_KEY_PATTERN)).toBeNull();
    expect("settings.format".match(TASK_KEY_PATTERN)).toBeNull();
  });

  test("does not match task key in middle of string", () => {
    expect("prefix.tasks[task_key='foo']".match(TASK_KEY_PATTERN)).toBeNull();
  });
});

describe("TASK_KEY_DOT_PREFIX_PATTERN", () => {
  test("matches task key prefix with trailing dot", () => {
    const key = "tasks[task_key='extract'].notebook_task";
    expect(TASK_KEY_DOT_PREFIX_PATTERN.test(key)).toBe(true);
  });

  test("strips the prefix from a key", () => {
    const key = "tasks[task_key='extract'].notebook_task.path";
    const stripped = key.replace(TASK_KEY_DOT_PREFIX_PATTERN, "");
    expect(stripped).toBe("notebook_task.path");
  });

  test("does not match bare task key without trailing dot", () => {
    expect(TASK_KEY_DOT_PREFIX_PATTERN.test("tasks[task_key='extract']")).toBe(false);
  });
});

describe("filterJobLevelChanges", () => {
  test("returns undefined for undefined input", () => {
    expect(filterJobLevelChanges(undefined)).toBeUndefined();
  });

  test("returns undefined when all changes are task-level", () => {
    const changes: Record<string, ChangeDesc> = {
      "tasks[task_key='extract'].path": makeChange("update"),
      "tasks[task_key='load']": makeChange("create"),
    };
    expect(filterJobLevelChanges(changes)).toBeUndefined();
  });

  test("returns only job-level entries", () => {
    const changes: Record<string, ChangeDesc> = {
      name: makeChange("update"),
      "tasks[task_key='extract'].path": makeChange("update"),
      "settings.format": makeChange("create"),
    };
    const result = filterJobLevelChanges(changes);
    expect(result).toEqual({
      name: makeChange("update"),
      "settings.format": makeChange("create"),
    });
  });

  test("returns all entries when none are task-level", () => {
    const changes: Record<string, ChangeDesc> = {
      name: makeChange("update"),
      description: makeChange("create"),
    };
    const result = filterJobLevelChanges(changes);
    expect(result).toEqual(changes);
  });

  test("returns undefined for empty changes object", () => {
    expect(filterJobLevelChanges({})).toBeUndefined();
  });
});

describe("collectChangesForTask", () => {
  test("returns empty array for undefined changes", () => {
    expect(collectChangesForTask("extract", undefined)).toEqual([]);
  });

  test("returns empty array when no changes match the task", () => {
    const changes: Record<string, ChangeDesc> = {
      name: makeChange("update"),
      "tasks[task_key='other'].path": makeChange("update"),
    };
    expect(collectChangesForTask("extract", changes)).toEqual([]);
  });

  test("collects all changes for the given task key", () => {
    const changes: Record<string, ChangeDesc> = {
      "tasks[task_key='extract']": makeChange("create"),
      "tasks[task_key='extract'].notebook_task": makeChange("update"),
      "tasks[task_key='load'].path": makeChange("update"),
      name: makeChange("update"),
    };
    const result = collectChangesForTask("extract", changes);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(["tasks[task_key='extract']", makeChange("create")]);
    expect(result[1]).toEqual(["tasks[task_key='extract'].notebook_task", makeChange("update")]);
  });

  test("returns entries as key-value pairs", () => {
    const changes: Record<string, ChangeDesc> = {
      "tasks[task_key='validate'].path": makeChange("update"),
    };
    const result = collectChangesForTask("validate", changes);
    expect(result).toHaveLength(1);
    const entry = result[0];
    expect(entry?.[0]).toBe("tasks[task_key='validate'].path");
    expect(entry?.[1]).toEqual(makeChange("update"));
  });
});
