import { describe, expect, test } from "bun:test";
import { parsePlanJson } from "../../src/parser/parse-plan.ts";
import { preparePlan } from "../../src/preparation/prepare-plan.ts";
import { normalizePlan } from "../../src/utils/normalize-plan.ts";
import taskCases from "./prepared-task-cases.json";

const prepareEntries = (entries: Readonly<Record<string, unknown>>) => {
  const parsed = parsePlanJson({ plan: entries });
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw new Error("test plan must parse");
  return preparePlan(normalizePlan(parsed.data.plan ?? {}));
};

const jobKey = "resources.jobs.example";
const bundleRef = (target: string): string => `\${${target}}`;
const job = (value: unknown, overrides: Readonly<Record<string, unknown>> = {}) => ({
  action: "update",
  new_state: { value },
  ...overrides,
});

describe("job preparation", () => {
  for (const taskCase of taskCases.cases) {
    test(taskCase.name, () => {
      const prepared = prepareEntries({ [jobKey]: taskCase.entry });
      const projection = prepared.byResourceKey.get(jobKey)?.job;
      expect(projection?.status).toBe("supported");
      if (projection?.status !== "supported") throw new Error("job should be prepared");
      expect(projection.value.currentTasks).toMatchObject(taskCase.expected.current);
      expect(projection.value.historicalTasks).toMatchObject(taskCase.expected.historical);
      expect(projection.value.deletedTasks).toMatchObject(
        taskCase.expected.deleted ?? { status: "absent" },
      );
      if (taskCase.expected.diagnostic) {
        expect(prepared.diagnostics).toContainEqual({
          resourceKey: jobKey,
          capability: "job-tasks",
          reason: "invalid-shape",
        });
      }
    });
  }

  test("keeps absent task projection distinct", () => {
    const prepared = prepareEntries({
      "resources.jobs.absent": job({ name: "no tasks" }),
    });
    expect(prepared.byResourceKey.get("resources.jobs.absent")?.job).toMatchObject({
      status: "supported",
      value: { currentTasks: { status: "absent" } },
    });
  });

  test("rejects malformed dependencies without remote fallback", () => {
    const prepared = prepareEntries({
      "resources.jobs.bad-dependency": job({
        tasks: [{ task_key: "task", depends_on: [{ task_key: 1 }] }],
      }),
    });
    expect(prepared.byResourceKey.get("resources.jobs.bad-dependency")?.job).toMatchObject({
      status: "supported",
      value: { currentTasks: { status: "unsupported" } },
    });
  });

  test("projects reference slices, vars, known clusters and opaque task data", () => {
    const opaque = { unknown: [1, 2] };
    const prepared = prepareEntries({
      [jobKey]: {
        ...job({
          job_clusters: [
            {
              job_cluster_key: "shared",
              new_cluster: { instance_pool_id: bundleRef("resources.instance_pools.pool.id") },
            },
          ],
          tasks: [
            {
              task_key: "run",
              run_job_task: { job_id: 0 },
              sql_task: { warehouse_id: "warehouse" },
              dashboard_task: { dashboard_id: "dashboard" },
              pipeline_task: { pipeline_id: "pipeline" },
              new_cluster: { spark_version: "1" },
              for_each_task: { task: { new_cluster: { driver_instance_pool_id: "pool-id" } } },
              extra: opaque,
            },
          ],
        }),
        new_state: {
          vars: { "tasks[0].run_job_task.job_id": bundleRef("resources.jobs.target.id") },
          value: {
            job_clusters: [
              {
                job_cluster_key: "shared",
                new_cluster: { instance_pool_id: bundleRef("resources.instance_pools.pool.id") },
              },
            ],
            tasks: [
              {
                task_key: "run",
                run_job_task: { job_id: 0 },
                sql_task: { warehouse_id: "warehouse" },
                dashboard_task: { dashboard_id: "dashboard" },
                pipeline_task: { pipeline_id: "pipeline" },
                new_cluster: { spark_version: "1" },
                for_each_task: { task: { new_cluster: { driver_instance_pool_id: "pool-id" } } },
                extra: opaque,
              },
            ],
          },
        },
      },
    });
    const projection = prepared.byResourceKey.get(jobKey)?.job;
    expect(projection?.status).toBe("supported");
    if (projection?.status !== "supported") throw new Error("job should be prepared");
    const tasks = projection.value.currentTasks;
    expect(tasks.status).toBe("supported");
    if (tasks.status !== "supported") throw new Error("tasks should be prepared");
    expect(tasks.value[0]).toMatchObject({
      taskKey: "run",
      runJob: { status: "supported", value: 0 },
      runJobTarget: { status: "supported", value: bundleRef("resources.jobs.target.id") },
      references: {
        warehouse_id: { status: "supported", value: "warehouse" },
        dashboard_id: { status: "supported", value: "dashboard" },
        pipeline_id: { status: "supported", value: "pipeline" },
      },
      cluster: { status: "supported", value: { rawState: { spark_version: "1" } } },
      rawState: { extra: opaque },
    });
    expect(projection.value.clusters).toMatchObject({
      status: "supported",
      value: [
        {
          instancePoolId: bundleRef("resources.instance_pools.pool.id"),
          rawState: { instance_pool_id: bundleRef("resources.instance_pools.pool.id") },
        },
        { rawState: { spark_version: "1" } },
        { driverInstancePoolId: "pool-id", rawState: { driver_instance_pool_id: "pool-id" } },
      ],
    });
    expect(prepared.normalized.entries[jobKey]?.new_state).toMatchObject({
      value: { tasks: [{ extra: opaque }] },
    });
  });

  test("excludes property changes and old-plus-new changes from whole-task deletions", () => {
    const prepared = prepareEntries({
      [jobKey]: job(
        { tasks: [] },
        {
          changes: {
            "tasks[task_key='property']": {
              old: { task_key: "property" },
              new: { task_key: "property" },
            },
            "tasks[task_key='updated'].timeout_seconds": {
              old: 10,
              new: 20,
            },
          },
        },
      ),
    });
    const projection = prepared.byResourceKey.get(jobKey)?.job;
    expect(projection?.status).toBe("supported");
    if (projection?.status !== "supported") throw new Error("job should be prepared");
    expect(projection.value.deletedTasks).toEqual({ status: "supported", value: [] });
  });

  test("preserves dependency details and reuses the selected remote task projection", () => {
    const prepared = prepareEntries({
      [jobKey]: {
        action: "delete",
        remote_state: {
          tasks: [{ task_key: "task", depends_on: [{ task_key: "other", outcome: "true" }] }],
        },
      },
    });
    const projection = prepared.byResourceKey.get(jobKey)?.job;
    expect(projection?.status).toBe("supported");
    if (projection?.status !== "supported") throw new Error("job should be prepared");
    expect(projection.value.currentTasks).toBe(projection.value.historicalTasks);
    expect(projection.value.currentTasks).toMatchObject({
      value: [{ rawState: { depends_on: [{ task_key: "other", outcome: "true" }] } }],
    });
  });

  test("reports malformed reference and cluster slices independently of valid DAG data", () => {
    const prepared = prepareEntries({
      [jobKey]: job({
        tasks: [
          {
            task_key: "task",
            depends_on: [],
            run_job_task: { job_id: false },
            sql_task: { warehouse_id: 3 },
            new_cluster: { instance_pool_id: 7, driver_instance_pool_id: false },
          },
        ],
      }),
    });
    const projection = prepared.byResourceKey.get(jobKey)?.job;
    expect(projection?.status).toBe("supported");
    if (projection?.status !== "supported") throw new Error("job should be prepared");
    const tasks = projection.value.currentTasks;
    expect(tasks.status).toBe("supported");
    if (tasks.status !== "supported") throw new Error("task list should remain usable");
    expect(tasks.value[0]?.dependencies).toEqual([]);
    expect(tasks.value[0]?.runJob.status).toBe("unsupported");
    expect(tasks.value[0]?.references["warehouse_id"]?.status).toBe("unsupported");
    expect(tasks.value[0]?.cluster.status).toBe("unsupported");
    expect(prepared.diagnostics).toContainEqual({
      resourceKey: jobKey,
      capability: "job-clusters",
      reason: "invalid-shape",
    });
    expect(JSON.stringify(prepared.diagnostics)).not.toContain("instance_pool_id");
  });
});
