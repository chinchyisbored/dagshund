import { describe, expect, test } from "bun:test";
import { buildJobIdMap, resolveRunJobTarget } from "../../src/graph/resolve-run-job-target.ts";
import type { PlanEntry } from "../../src/types/plan-schema.ts";

describe("resolveRunJobTarget", () => {
  test("string interpolation resolves to resource key via parseResourceReference", () => {
    const jobIdMap = new Map<number, string>();
    const target = resolveRunJobTarget(
      "${resources.jobs.downstream.id}",
      jobIdMap,
      undefined,
      "trigger",
    );
    expect(target).toBe("resources.jobs.downstream");
  });

  test("numeric id found in jobIdMap resolves to its resource key", () => {
    const jobIdMap = new Map<number, string>([[12345, "resources.jobs.downstream"]]);
    const target = resolveRunJobTarget(12345, jobIdMap, undefined, "trigger");
    expect(target).toBe("resources.jobs.downstream");
  });

  test("numeric placeholder 0 falls back to new_state.vars interpolation", () => {
    const jobIdMap = new Map<number, string>();
    const newState = {
      vars: {
        "tasks[0].run_job_task.job_id": "${resources.jobs.downstream.id}",
      },
      value: {
        tasks: [{ task_key: "trigger" }],
      },
    };
    const target = resolveRunJobTarget(0, jobIdMap, newState, "trigger");
    expect(target).toBe("resources.jobs.downstream");
  });

  test("unresolvable numeric id with empty vars returns undefined", () => {
    const jobIdMap = new Map<number, string>();
    const target = resolveRunJobTarget(99999, jobIdMap, undefined, "trigger");
    expect(target).toBeUndefined();
  });
});

describe("buildJobIdMap", () => {
  test("indexes jobs by remote_state.job_id and skips placeholder 0", () => {
    const entries: [string, PlanEntry][] = [
      [
        "resources.jobs.alpha",
        { action: "update", new_state: {}, remote_state: { job_id: 111 } } as PlanEntry,
      ],
      [
        "resources.jobs.beta",
        { action: "create", new_state: {}, remote_state: { job_id: 0 } } as PlanEntry,
      ],
      [
        "resources.jobs.gamma",
        { action: "update", new_state: {}, remote_state: { job_id: 222 } } as PlanEntry,
      ],
      [
        "resources.schemas.ignored",
        { action: "create", new_state: {}, remote_state: { job_id: 333 } } as PlanEntry,
      ],
    ];
    const map = buildJobIdMap(entries);
    expect(map.get(111)).toBe("resources.jobs.alpha");
    expect(map.get(222)).toBe("resources.jobs.gamma");
    expect(map.get(0)).toBeUndefined();
    expect(map.size).toBe(3);
  });

  test("entries without remote_state.job_id are ignored", () => {
    const entries: [string, PlanEntry][] = [
      ["resources.jobs.fresh", { action: "create", new_state: {} } as PlanEntry],
    ];
    const map = buildJobIdMap(entries);
    expect(map.size).toBe(0);
  });
});
