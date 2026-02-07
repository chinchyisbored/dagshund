import { describe, expect, test } from "bun:test";
import {
  extractJobState,
  extractTaskEntries,
  extractTaskState,
} from "../../src/graph/extract-tasks.ts";

describe("extractTaskEntries", () => {
  test("extracts tasks from a valid new_state", () => {
    const newState = {
      value: {
        tasks: [
          { task_key: "extract" },
          { task_key: "transform", depends_on: [{ task_key: "extract" }] },
        ],
      },
    };
    const tasks = extractTaskEntries(newState);
    expect(tasks).toHaveLength(2);
    const [first, second] = tasks;
    expect(first?.task_key).toBe("extract");
    expect(second?.task_key).toBe("transform");
    expect(second?.depends_on).toHaveLength(1);
  });

  test("returns empty array when new_state is undefined", () => {
    expect(extractTaskEntries(undefined)).toEqual([]);
  });

  test("returns empty array when value has no tasks", () => {
    expect(extractTaskEntries({ value: { name: "job" } })).toEqual([]);
  });

  test("returns empty array when new_state is not an object", () => {
    expect(extractTaskEntries("invalid")).toEqual([]);
  });

  test("preserves extra fields on tasks via passthrough", () => {
    const newState = {
      value: {
        tasks: [
          {
            task_key: "extract",
            notebook_task: { notebook_path: "/Workspace/etl/extract" },
          },
        ],
      },
    };
    const tasks = extractTaskEntries(newState);
    expect(tasks[0]).toHaveProperty("notebook_task");
  });
});

describe("extractJobState", () => {
  test("returns job-level fields excluding tasks", () => {
    const newState = {
      value: {
        name: "etl_pipeline",
        format: "MULTI_TASK",
        max_concurrent_runs: 1,
        tasks: [{ task_key: "extract" }],
      },
    };
    const state = extractJobState(newState);
    expect(state).toEqual({
      name: "etl_pipeline",
      format: "MULTI_TASK",
      max_concurrent_runs: 1,
    });
  });

  test("returns undefined when new_state is undefined", () => {
    expect(extractJobState(undefined)).toBeUndefined();
  });

  test("returns undefined when value is undefined", () => {
    expect(extractJobState({})).toBeUndefined();
  });

  test("returns undefined when value has only tasks", () => {
    const newState = {
      value: { tasks: [{ task_key: "extract" }] },
    };
    expect(extractJobState(newState)).toBeUndefined();
  });

  test("returns undefined for invalid input", () => {
    expect(extractJobState("invalid")).toBeUndefined();
  });
});

describe("extractTaskState", () => {
  test("returns task entry as a plain record", () => {
    const tasks = extractTaskEntries({
      value: {
        tasks: [
          {
            task_key: "extract",
            notebook_task: { notebook_path: "/Workspace/etl/extract" },
          },
        ],
      },
    });
    const state = extractTaskState(tasks[0]!);
    expect(state).toHaveProperty("task_key", "extract");
    expect(state).toHaveProperty("notebook_task");
  });
});
