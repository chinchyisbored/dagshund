import { describe, expect, test } from "bun:test";
import fixture from "../../../fixtures/wheel-suppression-cases.json";
import rawPlanFixture from "../../../fixtures/wheel-suppression-raw-plan.json";
import { buildPlanGraph } from "../../src/graph/build-plan-graph.ts";
import { buildResourceGraph } from "../../src/graph/build-resource-graph.ts";
import { resolveTaskDiffState } from "../../src/graph/resolve-task-diff-state.ts";
import { preparePlan } from "../../src/preparation/prepare-plan.ts";
import { planSchema } from "../../src/types/plan-schema.ts";
import { type NormalizedPlan, normalizePlan } from "../../src/utils/normalize-plan.ts";
import { applyWheelSuppression } from "../../src/utils/wheel-suppression.ts";
import { formatWheelUpdate } from "../../src/utils/wheel-updates.ts";

const wheel = {
  action: "update",
  old: "/artifacts/lib-1.0-py3-none-any.whl",
  new: "/artifacts/lib-2.0-py3-none-any.whl",
} as const;

describe("applyWheelSuppression", () => {
  test("effective classification reaches both public graph builders", () => {
    const parsed = planSchema.parse(rawPlanFixture);
    const original = normalizePlan(parsed.plan ?? {});
    const effective = applyWheelSuppression(original);
    const jobsGraph = buildPlanGraph(preparePlan(effective.plan));
    const resourcesGraph = buildResourceGraph(preparePlan(effective.plan));
    const job = jobsGraph.nodes.find((node) => node.nodeKind === "job");
    const wheelTask = jobsGraph.nodes.find(
      (node) => node.nodeKind === "task" && node.taskKey === "loop",
    );
    const pipeline = resourcesGraph.nodes.find(
      (node) => node.nodeKind === "resource" && node.resourceKey === "resources.pipelines.pipeline",
    );

    expect(job?.diffState).toBe("modified");
    expect(wheelTask?.diffState).toBe("modified");
    expect(pipeline?.diffState).toBe("modified");
    expect(effective.plan.entries["resources.jobs.job"]?.changes).not.toEqual(
      original.entries["resources.jobs.job"]?.changes,
    );
    expect(original.entries["resources.jobs.job"]?.action).toBe("update");
  });

  test("public graph paths distinguish wheel-only nodes and preserve topology and derived ownership", () => {
    const parsed = planSchema.parse({
      plan: {
        "resources.jobs.wheel": {
          action: "update",
          changes: {
            "tasks[task_key='loop'].for_each_task.task.libraries[0].whl": wheel,
          },
          new_state: {
            value: {
              job_id: 4,
              tasks: [
                {
                  task_key: "loop",
                  for_each_task: { task: { libraries: [{ whl: wheel.new }] } },
                },
              ],
            },
          },
          remote_state: { job_id: 4, tasks: [{ task_key: "loop" }] },
        },
        "resources.jobs.mixed": {
          action: "update",
          changes: {
            "tasks[task_key='wheel'].libraries[0].whl": wheel,
            "tasks[task_key='regular'].notebook_path": {
              action: "update",
              old: "/old.py",
              new: "/new.py",
            },
          },
          new_state: {
            value: {
              tasks: [{ task_key: "wheel" }, { task_key: "regular" }],
            },
          },
        },
        "resources.pipelines.wheel": {
          action: "update",
          changes: { "libraries[0].whl": wheel },
          new_state: {
            value: {
              event_log: { catalog: "dagshund", schema: "ops", name: "events" },
            },
          },
        },
      },
    });
    const original = normalizePlan(parsed.plan ?? {});
    const effective = applyWheelSuppression(original);
    const originalJobs = buildPlanGraph(preparePlan(original));
    const effectiveJobs = buildPlanGraph(preparePlan(effective.plan));
    const originalResources = buildResourceGraph(preparePlan(original));
    const effectiveResources = buildResourceGraph(preparePlan(effective.plan));
    const findNode = (graph: typeof originalJobs, id: string) =>
      graph.nodes.find((node) => node.id === id);

    expect(findNode(originalJobs, "resources.jobs.wheel")?.diffState).toBe("modified");
    expect(findNode(effectiveJobs, "resources.jobs.wheel")?.diffState).toBe("unchanged");
    expect(
      effectiveJobs.nodes.find((node) => node.nodeKind === "task" && node.taskKey === "loop")
        ?.diffState,
    ).toBe("unchanged");
    expect(originalJobs.edges.map(({ id }) => id).toSorted()).toEqual(
      effectiveJobs.edges.map(({ id }) => id).toSorted(),
    );
    expect(findNode(originalResources, "resources.pipelines.wheel")?.diffState).toBe("modified");
    expect(findNode(effectiveResources, "resources.pipelines.wheel")?.diffState).toBe("unchanged");
    expect(
      effectiveResources.nodes.find((node) => node.id === "pipeline-event-log::dagshund.ops.events")
        ?.diffState,
    ).toBe("unchanged");
    expect(originalResources.lateralEdges).toEqual(effectiveResources.lateralEdges);
    const mixed = effectiveJobs.nodes.find(
      (node) => node.nodeKind === "job" && node.resourceKey === "resources.jobs.mixed",
    );
    expect(mixed?.diffState).toBe("modified");
    expect(
      mixed?.nodeKind === "job"
        ? mixed.taskChangeSummary?.map(({ taskKey }) => taskKey)
        : undefined,
    ).toEqual(["regular"]);
    expect(
      effectiveJobs.nodes.find((node) => node.nodeKind === "task" && node.taskKey === "wheel")
        ?.diffState,
    ).toBe("unchanged");
  });

  test("matches the shared effective-projection vectors", () => {
    for (const testCase of fixture.cases) {
      const parsed = planSchema.parse({ plan: testCase.resources });
      const normalized = normalizePlan(parsed.plan ?? {});
      const result = applyWheelSuppression(normalized);
      const actions: Record<string, string> = Object.fromEntries(
        Object.entries(result.plan.entries).map(([key, entry]) => [key, entry.action ?? ""]),
      );
      const remainingChanges: Record<string, string[]> = Object.fromEntries(
        Object.entries(result.plan.entries).map(([key, entry]) => [
          key,
          Object.keys(entry.changes ?? {}).toSorted(),
        ]),
      );
      const usages = result.usages.map(
        ({ update, taskCount, environmentCount, pipelineCount }) => ({
          distribution: update.distribution,
          oldRequirement: update.oldRequirement,
          newRequirement: update.newRequirement,
          taskCount,
          environmentCount,
          pipelineCount,
        }),
      );

      expect(JSON.stringify(actions)).toBe(JSON.stringify(testCase.expected.actions));
      expect(JSON.stringify(remainingChanges)).toBe(
        JSON.stringify(testCase.expected.remainingChanges),
      );
      const expectedPayloads = testCase.expected.remainingPayloads;
      if (expectedPayloads !== undefined) {
        for (const [key, changes] of Object.entries(expectedPayloads)) {
          const actualChanges = result.plan.entries[key]?.changes ?? {};
          const sortEntries = (entries: [string, unknown][]) =>
            entries.toSorted(([left], [right]) => left.localeCompare(right));
          expect(JSON.stringify(sortEntries(Object.entries(actualChanges)))).toBe(
            JSON.stringify(sortEntries(Object.entries(changes))),
          );
        }
      }
      expect(usages).toEqual(testCase.expected.usages);
    }
  });
  test("projects a complete normalized raw plan without losing effects or state", () => {
    const fixtureSnapshot = JSON.stringify(rawPlanFixture);
    const parsed = planSchema.parse(rawPlanFixture);
    const normalized = normalizePlan(parsed.plan ?? {});
    const normalizedSnapshot = JSON.stringify(normalized);

    const result = applyWheelSuppression(normalized);

    expect(JSON.stringify(rawPlanFixture)).toBe(fixtureSnapshot);
    expect(JSON.stringify(normalized)).toBe(normalizedSnapshot);

    const job = result.plan.entries["resources.jobs.job"];
    expect(job?.action).toBe("update");
    expect(job?.changes).toEqual(
      Object.fromEntries(
        Object.entries(normalized.entries["resources.jobs.job"]?.changes ?? {}).filter(
          ([key]) => !key.endsWith(".libraries[0].whl") && !key.endsWith(".spec.dependencies[0]"),
        ),
      ),
    );
    expect(job?.changes?.["permissions.[0].level"]).toBeDefined();
    expect(job?.changes?.["tasks[task_key='loop'].depends_on[0]"]).toEqual({
      action: "update",
      old: [{ task_key: "before" }],
      new: [{ task_key: "after" }],
    });
    expect(job?.changes?.["tasks[task_key='run'].run_job_task.job_id"]?.new).toBe(11);
    expect(job?.changes?.["tasks[task_key='pipeline'].pipeline_task.pipeline_id"]?.new).toBe(
      "after-pipeline",
    );
    expect(job?.new_state).toMatchObject({
      value: { tasks: [{ task_key: "loop" }, { task_key: "run" }, { task_key: "pipeline" }] },
    });
    expect(job?.remote_state).toMatchObject({
      tasks: [{ task_key: "loop" }, { task_key: "run" }, { task_key: "pipeline" }],
    });
    expect(result.plan.entries["resources.jobs.target"]?.remote_state).toEqual({
      job_id: 11,
      name: "managed-target",
    });
    expect(result.plan.entries["resources.pipelines.pipeline"]?.new_state).toMatchObject({
      value: { pipeline_id: "after-pipeline" },
    });
    expect(result.plan.entries["resources.pipelines.pipeline"]?.new_state).toEqual(
      normalized.entries["resources.pipelines.pipeline"]?.new_state,
    );
    expect(result.plan.entries["resources.pipelines.pipeline"]?.remote_state).toEqual(
      normalized.entries["resources.pipelines.pipeline"]?.remote_state,
    );
    expect(result.plan.entries["resources.pipelines.pipeline"]?.depends_on).toEqual(
      normalized.entries["resources.pipelines.pipeline"]?.depends_on,
    );
    expect(job?.effects).toEqual(normalized.entries["resources.jobs.job"]?.effects);
    expect(result.plan.orphanEffects).toEqual(normalized.orphanEffects);
    expect(result.plan.entries["resources.jobs.target"]).toEqual(
      normalized.entries["resources.jobs.target"],
    );
    expect(result.plan.entries["resources.pipelines.pipeline"]?.action).toBe("update");
    expect(JSON.stringify(result.plan.entries["resources.pipelines.pipeline"]?.changes)).toBe(
      JSON.stringify(
        Object.fromEntries(
          Object.entries(normalized.entries["resources.pipelines.pipeline"]?.changes ?? {}).filter(
            ([key]) => key === "continuous",
          ),
        ),
      ),
    );
    expect(Object.keys(result.plan.entries["resources.pipelines.pipeline"]?.changes ?? {})).toEqual(
      ["continuous"],
    );
    expect(job?.new_state).toEqual(normalized.entries["resources.jobs.job"]?.new_state);
    expect(job?.remote_state).toEqual(normalized.entries["resources.jobs.job"]?.remote_state);
    expect(
      result.usages
        .map(({ taskCount, environmentCount, pipelineCount }) =>
          JSON.stringify([taskCount, environmentCount, pipelineCount]),
        )
        .toSorted(),
    ).toEqual(["[0,0,1]", "[0,0,1]", "[0,1,0]", "[1,0,0]"]);
  });

  test("suppresses wheel-only resources and retains mixed changes", () => {
    const plan: NormalizedPlan = {
      entries: {
        "resources.jobs.first": {
          action: "update",
          changes: {
            "tasks[task_key='same'].libraries[0].whl": wheel,
            "permissions[0].level": { action: "update", old: "CAN_VIEW", new: "CAN_MANAGE" },
          },
        },
        "resources.jobs.second": {
          action: "update",
          changes: { "tasks[task_key='same'].libraries[1].whl": wheel },
        },
      },
      orphanEffects: [],
    };

    const result = applyWheelSuppression(plan);

    expect(result.plan.entries["resources.jobs.first"]?.changes).toEqual({
      "permissions[0].level": { action: "update", old: "CAN_VIEW", new: "CAN_MANAGE" },
    });
    expect(result.plan.entries["resources.jobs.second"]?.action).toBe("skip");
    expect(result.usages[0]?.taskCount).toBe(2);
    expect(plan.entries["resources.jobs.second"]?.action).toBe("update");
  });

  test("neutral whole-task entries defer to substantive task changes and preserve off mode", () => {
    const plan: NormalizedPlan = {
      entries: {
        "resources.jobs.job": {
          action: "update",
          changes: {
            "tasks[task_key='task'].libraries[0].whl": wheel,
            "tasks[task_key='task']": {
              action: "skip",
              old: { task_key: "task" },
              new: { task_key: "task" },
            },
          },
        },
      },
      orphanEffects: [],
    };
    const original = plan.entries["resources.jobs.job"];
    const projected = applyWheelSuppression(plan).plan.entries["resources.jobs.job"];

    expect(resolveTaskDiffState("task", original?.action, original?.changes)).toBe("modified");
    expect(projected?.action).toBe("skip");
    expect(resolveTaskDiffState("task", projected?.action, projected?.changes)).toBe("unchanged");

    const mixed = {
      ...plan,
      entries: {
        "resources.jobs.job": {
          ...original,
          changes: {
            ...original?.changes,
            "tasks[task_key='task'].notebook_path": {
              action: "update",
              old: "/old.py",
              new: "/new.py",
            },
          },
        },
      },
    } satisfies NormalizedPlan;
    const mixedProjection = applyWheelSuppression(mixed).plan.entries["resources.jobs.job"];
    expect(mixedProjection?.action).toBe("update");
    expect(resolveTaskDiffState("task", mixedProjection?.action, mixedProjection?.changes)).toBe(
      "modified",
    );
  });

  test("preserves create, delete, recreate, resize, update_id, and unknown resources", () => {
    for (const action of [
      "create",
      "delete",
      "recreate",
      "resize",
      "update_id",
      "unknown",
    ] as const) {
      const entry = { action, changes: { "tasks[task_key='task'].libraries[0].whl": wheel } };
      const plan: NormalizedPlan = {
        entries: { "resources.jobs.job": entry },
        orphanEffects: [],
      };

      const result = applyWheelSuppression(plan);

      expect(result.plan.entries["resources.jobs.job"]).toEqual(entry);
      expect(result.usages).toEqual([]);
    }
  });

  test("preserves state and dependencies while counting nested and pipeline carriers", () => {
    const plan: NormalizedPlan = {
      entries: {
        "resources.jobs.job": {
          action: "update",
          depends_on: [{ node: "resources.jobs.other", label: "managed" }],
          new_state: { value: { tasks: [{ task_key: "loop" }] } },
          remote_state: { tasks: [{ task_key: "loop" }] },
          changes: {
            "tasks[task_key='loop'].for_each_task.task.libraries[0].whl": {
              action: "update",
              old: "/a/lib-1.0-py3-none-any.whl",
              new: "/a/lib-2.0-py3-none-any.whl",
            },
            "environments[environment_key='serverless'].spec.dependencies[0]": {
              action: "update",
              old: "/a/env-1.0-py3-none-any.whl",
              new: "/a/env-2.0-py3-none-any.whl",
            },
            "tasks[task_key='loop'].depends_on[0]": {
              action: "update",
              old: { task_key: "old" },
              new: { task_key: "new" },
            },
          },
        },
        "resources.pipelines.pipeline": {
          action: "update",
          changes: {
            "environment.dependencies[0]": {
              action: "update",
              old: "/a/pipeline-1.0-py3-none-any.whl",
              new: "/a/pipeline-2.0-py3-none-any.whl",
            },
          },
        },
      },
      orphanEffects: [],
    };
    const original = JSON.stringify(plan);

    const result = applyWheelSuppression(plan);

    expect(JSON.stringify(plan)).toBe(original);
    expect(result.plan.entries["resources.jobs.job"]?.new_state).toEqual(
      plan.entries["resources.jobs.job"]?.new_state,
    );
    expect(result.plan.entries["resources.jobs.job"]?.depends_on).toEqual([
      { node: "resources.jobs.other", label: "managed" },
    ]);
    expect(
      result.plan.entries["resources.jobs.job"]?.changes?.["tasks[task_key='loop'].depends_on[0]"],
    ).toBeDefined();
    expect(
      result.usages.map(({ taskCount, environmentCount, pipelineCount }) => [
        taskCount,
        environmentCount,
        pipelineCount,
      ]),
    ).toEqual([
      [0, 1, 0],
      [1, 0, 0],
      [0, 0, 1],
    ]);
  });

  test("preserves unknown action evidence while suppressing eligible wheels", () => {
    const plan: NormalizedPlan = {
      entries: {
        "resources.jobs.job": {
          action: "update",
          changes: {
            "tasks[task_key='task'].libraries[0].whl": wheel,
            opaque: { action: "unknown", old: "same", new: "same", remote: "same" },
          },
        },
      },
      orphanEffects: [],
    };

    const result = applyWheelSuppression(plan);

    expect(result.plan.entries["resources.jobs.job"]?.action).toBe("update");
    expect(result.plan.entries["resources.jobs.job"]?.changes?.["opaque"]?.action).toBe("unknown");
  });

  test("sorts case-sensitive requirements and formats ambiguous transitions", () => {
    const upper = {
      distribution: "lib",
      oldVersion: "1.0",
      newVersion: "2.0",
      oldRequirement: "/A/lib-1.0.whl",
      newRequirement: "/A/lib-2.0.whl",
    };
    const lower = {
      ...upper,
      oldRequirement: "/a/lib-1.0.whl",
      newRequirement: "/a/lib-2.0.whl",
    };

    const plan: NormalizedPlan = {
      entries: {
        "resources.jobs.job": {
          action: "update",
          changes: {
            "tasks[task_key='lower'].libraries[0].whl": {
              action: "update",
              old: "/a/lib-1.0-py3-none-any.whl",
              new: "/a/lib-2.0-py3-none-any.whl",
            },
            "tasks[task_key='upper'].libraries[0].whl": {
              action: "update",
              old: "/A/lib-1.0-py3-none-any.whl",
              new: "/A/lib-2.0-py3-none-any.whl",
            },
          },
        },
      },
      orphanEffects: [],
    };
    const result = applyWheelSuppression(plan);
    expect(result.usages.map(({ update }) => update.oldRequirement)).toEqual([
      "/A/lib-1.0-py3-none-any.whl",
      "/a/lib-1.0-py3-none-any.whl",
    ]);

    expect(formatWheelUpdate(upper, [upper, lower])).toBe("lib: /A/lib-1.0.whl → /A/lib-2.0.whl");
    expect(formatWheelUpdate({ ...upper, oldVersion: "1.0", newVersion: "1.0" }, [])).toBe(
      "lib: /A/lib-1.0.whl → /A/lib-2.0.whl",
    );
  });

  test("does not suppress pipeline-looking job libraries or non-update actions", () => {
    const plan: NormalizedPlan = {
      entries: {
        "resources.jobs.created": { action: "create", changes: { "libraries[0].whl": wheel } },
        "resources.jobs.ordinary": { action: "update", changes: { "libraries[0].whl": wheel } },
      },
      orphanEffects: [],
    };

    const result = applyWheelSuppression(plan);

    expect(result.usages).toEqual([]);
    expect(result.plan.entries).toEqual(plan.entries);
  });
});
