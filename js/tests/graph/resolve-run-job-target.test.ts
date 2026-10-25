import { describe, expect, test } from "bun:test";
import {
  buildJobIdMap,
  resolvePreparedRunJobTarget,
} from "../../src/graph/resolve-run-job-target.ts";
import type { PreparedTask } from "../../src/preparation/prepare-job.ts";
import type { PlanEntry } from "../../src/types/plan-schema.ts";

const downstreamJobRef = `\${resources.jobs.downstream.id}`;

const makeTask = (
  jobId: string | number,
  target: PreparedTask["runJobTarget"] = { status: "absent" },
): PreparedTask => ({
  taskKey: "trigger",
  dependencies: [],
  rawState: { task_key: "trigger" },
  runJob: { status: "supported", value: jobId },
  runJobTarget: target,
  references: {},
  cluster: { status: "absent" },
});

describe("resolvePreparedRunJobTarget", () => {
  test("string interpolation resolves to resource key", () => {
    const target = resolvePreparedRunJobTarget(makeTask(downstreamJobRef), new Map());
    expect(target).toBe("resources.jobs.downstream");
  });

  test("numeric id found in jobIdMap resolves to its resource key", () => {
    const target = resolvePreparedRunJobTarget(
      makeTask(12345),
      new Map([[12345, "resources.jobs.downstream"]]),
    );
    expect(target).toBe("resources.jobs.downstream");
  });

  test("numeric placeholder uses prepared vars interpolation", () => {
    const target = resolvePreparedRunJobTarget(
      makeTask(0, { status: "supported", value: downstreamJobRef }),
      new Map(),
    );
    expect(target).toBe("resources.jobs.downstream");
  });

  test("unresolvable numeric id returns undefined", () => {
    expect(resolvePreparedRunJobTarget(makeTask(99999), new Map())).toBeUndefined();
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
    expect(map.size).toBe(2);
  });

  test("entries without remote_state.job_id are ignored", () => {
    const entries: [string, PlanEntry][] = [
      ["resources.jobs.fresh", { action: "create", new_state: {} } as PlanEntry],
    ];
    expect(buildJobIdMap(entries).size).toBe(0);
  });
});
