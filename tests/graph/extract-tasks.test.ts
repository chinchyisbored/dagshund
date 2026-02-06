import { describe, test, expect } from "bun:test";
import { extractTaskEntries } from "../../src/graph/extract-tasks.ts";

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
