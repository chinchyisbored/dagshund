import { describe, expect, test } from "bun:test";
import {
  extractDeletedTaskEntries,
  extractJobState,
  extractJobStateFromRemoteState,
  extractTaskEntries,
  extractTaskEntriesFromRemoteState,
  extractTaskState,
  resolveJobState,
  resolveTaskEntries,
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

describe("extractTaskEntriesFromRemoteState", () => {
  test("extracts tasks from flat remote_state with tasks array", () => {
    const remoteState = {
      name: "etl_pipeline",
      tasks: [
        { task_key: "extract" },
        { task_key: "transform", depends_on: [{ task_key: "extract" }] },
      ],
    };
    const tasks = extractTaskEntriesFromRemoteState(remoteState);
    expect(tasks).toHaveLength(2);
    expect(tasks[0]?.task_key).toBe("extract");
    expect(tasks[1]?.depends_on).toHaveLength(1);
  });

  test("returns empty array when remote_state is undefined", () => {
    expect(extractTaskEntriesFromRemoteState(undefined)).toEqual([]);
  });

  test("returns empty array when remote_state has no tasks", () => {
    expect(extractTaskEntriesFromRemoteState({ name: "alert" })).toEqual([]);
  });

  test("returns empty array for non-object input", () => {
    expect(extractTaskEntriesFromRemoteState("invalid")).toEqual([]);
  });
});

describe("resolveTaskEntries", () => {
  test("prefers new_state tasks when available", () => {
    const newState = { value: { tasks: [{ task_key: "from_new" }] } };
    const remoteState = { tasks: [{ task_key: "from_remote" }] };
    const tasks = resolveTaskEntries(newState, remoteState);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.task_key).toBe("from_new");
  });

  test("falls back to remote_state when new_state is undefined", () => {
    const remoteState = { tasks: [{ task_key: "from_remote" }] };
    const tasks = resolveTaskEntries(undefined, remoteState);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.task_key).toBe("from_remote");
  });

  test("falls back to remote_state when new_state has no tasks", () => {
    const newState = { value: { name: "job" } };
    const remoteState = { tasks: [{ task_key: "from_remote" }] };
    const tasks = resolveTaskEntries(newState, remoteState);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.task_key).toBe("from_remote");
  });

  test("returns empty when both sources have no tasks", () => {
    expect(resolveTaskEntries(undefined, undefined)).toEqual([]);
    expect(resolveTaskEntries(undefined, { name: "job" })).toEqual([]);
  });
});

describe("extractJobStateFromRemoteState", () => {
  test("returns remote_state fields excluding tasks", () => {
    const remoteState = {
      name: "etl_pipeline",
      format: "MULTI_TASK",
      tasks: [{ task_key: "extract" }],
    };
    const state = extractJobStateFromRemoteState(remoteState);
    expect(state).toHaveProperty("name", "etl_pipeline");
    expect(state).toHaveProperty("format", "MULTI_TASK");
    expect(state).not.toHaveProperty("tasks");
  });

  test("returns undefined when remote_state is undefined", () => {
    expect(extractJobStateFromRemoteState(undefined)).toBeUndefined();
  });

  test("returns undefined for non-object input", () => {
    expect(extractJobStateFromRemoteState("invalid")).toBeUndefined();
  });
});

describe("resolveJobState", () => {
  test("prefers new_state when available", () => {
    const newState = { value: { name: "from_new", tasks: [] } };
    const remoteState = { name: "from_remote", tasks: [] };
    const state = resolveJobState(newState, remoteState);
    expect(state).toHaveProperty("name", "from_new");
  });

  test("falls back to remote_state when new_state is undefined", () => {
    const remoteState = { name: "from_remote", tasks: [] };
    const state = resolveJobState(undefined, remoteState);
    expect(state).toHaveProperty("name", "from_remote");
  });

  test("falls back to remote_state when new_state.value only has tasks", () => {
    const newState = { value: { tasks: [{ task_key: "extract" }] } };
    const remoteState = { name: "from_remote", tasks: [] };
    const state = resolveJobState(newState, remoteState);
    expect(state).toHaveProperty("name", "from_remote");
  });
});

describe("extractDeletedTaskEntries", () => {
  test("extracts deleted tasks from changes record", () => {
    const changes = {
      "tasks[task_key='validate']": {
        action: "delete",
        old: {
          task_key: "validate",
          depends_on: [{ task_key: "load" }],
          notebook_task: { notebook_path: "/Workspace/etl/validate" },
        },
      },
    };
    const deleted = extractDeletedTaskEntries(changes);
    expect(deleted).toHaveLength(1);
    expect(deleted[0]?.task_key).toBe("validate");
    expect(deleted[0]?.depends_on).toHaveLength(1);
  });

  test("ignores changes with both old and new (not a delete)", () => {
    const changes = {
      "tasks[task_key='transform']": {
        action: "update",
        old: { task_key: "transform" },
        new: { task_key: "transform", notebook_task: { notebook_path: "/new" } },
      },
    };
    const deleted = extractDeletedTaskEntries(changes);
    expect(deleted).toHaveLength(0);
  });

  test("ignores sub-property change keys (has trailing dot/property)", () => {
    const changes = {
      "tasks[task_key='transform'].notebook_task.notebook_path": {
        action: "update",
        old: "/old",
        new: "/new",
      },
    };
    const deleted = extractDeletedTaskEntries(changes);
    expect(deleted).toHaveLength(0);
  });

  test("returns empty array when changes is undefined", () => {
    expect(extractDeletedTaskEntries(undefined)).toEqual([]);
  });

  test("returns empty array when no deletions exist", () => {
    const changes = {
      "tasks[task_key='extract']": {
        action: "create",
        new: { task_key: "extract" },
      },
    };
    const deleted = extractDeletedTaskEntries(changes);
    expect(deleted).toHaveLength(0);
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
    // biome-ignore lint/style/noNonNullAssertion: test array has exactly one element
    const state = extractTaskState(tasks[0]!);
    expect(state).toHaveProperty("task_key", "extract");
    expect(state).toHaveProperty("notebook_task");
  });
});
