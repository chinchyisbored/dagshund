import { describe, expect, test } from "bun:test";
import { extractTaskTypeBadge } from "../../src/utils/task-type.ts";

describe("extractTaskTypeBadge", () => {
  test("returns badge for known task types", () => {
    expect(extractTaskTypeBadge({ notebook_task: {} })).toBe("notebook");
    expect(extractTaskTypeBadge({ python_wheel_task: {} })).toBe("wheel");
    expect(extractTaskTypeBadge({ run_job_task: {} })).toBe("run job");
    expect(extractTaskTypeBadge({ sql_task: {} })).toBe("sql");
    expect(extractTaskTypeBadge({ dbt_task: {} })).toBe("dbt");
    expect(extractTaskTypeBadge({ pipeline_task: {} })).toBe("pipeline");
    expect(extractTaskTypeBadge({ spark_jar_task: {} })).toBe("spark jar");
    expect(extractTaskTypeBadge({ spark_python_task: {} })).toBe("spark py");
    expect(extractTaskTypeBadge({ spark_submit_task: {} })).toBe("spark submit");
    expect(extractTaskTypeBadge({ condition_task: {} })).toBe("condition");
    expect(extractTaskTypeBadge({ for_each_task: {} })).toBe("for each");
  });

  test("falls back to stripped key for unknown _task keys", () => {
    expect(extractTaskTypeBadge({ custom_magic_task: {} })).toBe("custom magic");
  });

  test("returns undefined for undefined input", () => {
    expect(extractTaskTypeBadge(undefined)).toBeUndefined();
  });

  test("returns undefined when no task type key is present", () => {
    expect(extractTaskTypeBadge({ description: "some job", timeout: 300 })).toBeUndefined();
  });

  test("ignores non-task keys alongside a task key", () => {
    expect(extractTaskTypeBadge({ depends_on: [], notebook_task: { path: "/nb" } })).toBe(
      "notebook",
    );
  });
});
