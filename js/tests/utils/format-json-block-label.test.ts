import { describe, expect, test } from "bun:test";
import { formatJsonBlockLabel } from "../../src/utils/format-json-block-label.ts";

describe("formatJsonBlockLabel", () => {
  test("strips resources prefix from resource key", () => {
    const result = formatJsonBlockLabel("resources.jobs.my_job");

    expect(result).toBe("jobs.my_job");
  });

  test("strips resources prefix from nested resource key", () => {
    const result = formatJsonBlockLabel("resources.jobs.my_job.permissions");

    expect(result).toBe("jobs.my_job.permissions");
  });

  test("passes through task-slice labels unchanged", () => {
    const result = formatJsonBlockLabel("new_state.value.tasks[0]");

    expect(result).toBe("new_state.value.tasks[0]");
  });

  test("passes through changes labels unchanged", () => {
    const result = formatJsonBlockLabel("changes (filtered to aws_iam_role:ingest)");

    expect(result).toBe("changes (filtered to aws_iam_role:ingest)");
  });

  test("returns empty string when label is only the prefix", () => {
    const result = formatJsonBlockLabel("resources.");

    expect(result).toBe("");
  });

  test("returns empty string unchanged", () => {
    const result = formatJsonBlockLabel("");

    expect(result).toBe("");
  });
});
