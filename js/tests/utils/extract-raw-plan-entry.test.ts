import { describe, expect, test } from "bun:test";
import type { DagNodeData } from "../../src/types/graph-types.ts";
import type { Plan, PlanEntry } from "../../src/types/plan-schema.ts";
import { extractRawPlanSlice } from "../../src/utils/extract-raw-plan-entry.ts";

// ---------------------------------------------------------------------------
// Test data builders
// ---------------------------------------------------------------------------

const buildPlan = (entries: Record<string, PlanEntry>): Plan => ({
  plan_version: 1,
  plan: entries,
});

const buildResourceData = (resourceKey: string): DagNodeData => ({
  nodeKind: "resource" as const,
  label: resourceKey.split(".").at(-1) ?? resourceKey,
  diffState: "added",
  resourceKey,
  changes: undefined,
  resourceState: undefined,
  taskChangeSummary: undefined,
});

const buildJobData = (resourceKey: string): DagNodeData => ({
  nodeKind: "job" as const,
  label: resourceKey.split(".").at(-1) ?? resourceKey,
  diffState: "modified",
  resourceKey,
  changes: undefined,
  resourceState: undefined,
  taskChangeSummary: undefined,
});

const buildTaskData = (resourceKey: string, taskKey: string): DagNodeData => ({
  nodeKind: "task" as const,
  label: taskKey,
  diffState: "modified",
  resourceKey,
  taskKey,
  changes: undefined,
  resourceState: undefined,
});

const buildRootData = (): DagNodeData => ({
  nodeKind: "root" as const,
  label: "Root",
  diffState: "unchanged",
  resourceKey: "uc-root",
  changes: undefined,
  resourceState: undefined,
});

const buildPhantomData = (): DagNodeData => ({
  nodeKind: "phantom" as const,
  label: "missing",
  diffState: "unchanged",
  resourceKey: "catalog::missing",
  changes: undefined,
  resourceState: undefined,
});

const SIMPLE_ENTRY: PlanEntry = {
  action: "create",
  new_state: { value: { display_name: "My Alert" } },
};

const JOB_ENTRY: PlanEntry = {
  action: "update",
  new_state: {
    value: {
      name: "etl_pipeline",
      tasks: [
        { task_key: "extract", notebook_task: { notebook_path: "/extract" } },
        { task_key: "load", depends_on: [{ task_key: "extract" }] },
      ],
    },
  },
  remote_state: {
    name: "etl_pipeline",
    tasks: [{ task_key: "extract", notebook_task: { notebook_path: "/extract_old" } }],
  },
  changes: {
    "tasks[task_key='extract'].notebook_task.notebook_path": {
      action: "update",
      old: "/extract_old",
      new: "/extract",
    },
    "tasks[task_key='load']": {
      action: "create",
      new: { task_key: "load", depends_on: [{ task_key: "extract" }] },
    },
    name: { action: "update", old: "old_name", new: "etl_pipeline" },
  },
};

// ---------------------------------------------------------------------------
// extractRawPlanSlice — undefined cases
// ---------------------------------------------------------------------------

describe("extractRawPlanSlice", () => {
  test("returns undefined when plan.plan is undefined", () => {
    const plan: Plan = { plan_version: 1 };
    expect(extractRawPlanSlice(plan, buildResourceData("resources.alerts.foo"))).toBeUndefined();
  });

  test("returns undefined for root nodes", () => {
    const plan = buildPlan({ "resources.alerts.foo": SIMPLE_ENTRY });
    expect(extractRawPlanSlice(plan, buildRootData())).toBeUndefined();
  });

  test("returns undefined for phantom nodes", () => {
    const plan = buildPlan({ "resources.alerts.foo": SIMPLE_ENTRY });
    expect(extractRawPlanSlice(plan, buildPhantomData())).toBeUndefined();
  });

  test("returns undefined when resource key not found in plan", () => {
    const plan = buildPlan({ "resources.alerts.foo": SIMPLE_ENTRY });
    expect(
      extractRawPlanSlice(plan, buildResourceData("resources.alerts.missing")),
    ).toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // entry kind — simple resources
  // ---------------------------------------------------------------------------

  describe("entry kind", () => {
    test("returns entry for a simple resource", () => {
      const plan = buildPlan({ "resources.alerts.foo": SIMPLE_ENTRY });
      const result = extractRawPlanSlice(plan, buildResourceData("resources.alerts.foo"));

      expect(result).toEqual({ kind: "entry", data: SIMPLE_ENTRY });
    });

    test("returns entry for a job resource with no sub-resources", () => {
      const plan = buildPlan({ "resources.jobs.etl": JOB_ENTRY });
      const result = extractRawPlanSlice(plan, buildJobData("resources.jobs.etl"));

      expect(result).toEqual({ kind: "entry", data: JOB_ENTRY });
    });

    test("returned data is the same reference as the plan entry", () => {
      const plan = buildPlan({ "resources.alerts.foo": SIMPLE_ENTRY });
      const result = extractRawPlanSlice(plan, buildResourceData("resources.alerts.foo"));

      expect(result?.kind).toBe("entry");
      if (result?.kind === "entry") {
        expect(result.data).toBe(SIMPLE_ENTRY);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // entry-with-subs kind
  // ---------------------------------------------------------------------------

  describe("entry-with-subs kind", () => {
    const PERM_ENTRY: PlanEntry = {
      action: "skip",
      new_state: { value: { permissions: [{ group_name: "admins" }] } },
    };

    test("returns entry-with-subs when sub-resources exist", () => {
      const plan = buildPlan({
        "resources.jobs.foo": JOB_ENTRY,
        "resources.jobs.foo.permissions": PERM_ENTRY,
      });
      const result = extractRawPlanSlice(plan, buildJobData("resources.jobs.foo"));

      expect(result?.kind).toBe("entry-with-subs");
      if (result?.kind === "entry-with-subs") {
        expect([...result.entries.keys()]).toEqual([
          "resources.jobs.foo",
          "resources.jobs.foo.permissions",
        ]);
        expect(result.entries.get("resources.jobs.foo")).toBe(JOB_ENTRY);
        expect(result.entries.get("resources.jobs.foo.permissions")).toBe(PERM_ENTRY);
      }
    });

    test("includes multiple sub-resources", () => {
      const grantsEntry: PlanEntry = { action: "create" };
      const plan = buildPlan({
        "resources.schemas.analytics": SIMPLE_ENTRY,
        "resources.schemas.analytics.grants": grantsEntry,
        "resources.schemas.analytics.permissions": PERM_ENTRY,
      });
      const result = extractRawPlanSlice(plan, buildResourceData("resources.schemas.analytics"));

      expect(result?.kind).toBe("entry-with-subs");
      if (result?.kind === "entry-with-subs") {
        expect(result.entries.size).toBe(3);
      }
    });

    test("does not match keys that share a prefix but are different resources", () => {
      const plan = buildPlan({
        "resources.jobs.foo": JOB_ENTRY,
        "resources.jobs.foobar": SIMPLE_ENTRY,
      });
      const result = extractRawPlanSlice(plan, buildJobData("resources.jobs.foo"));

      expect(result).toEqual({ kind: "entry", data: JOB_ENTRY });
    });
  });

  // ---------------------------------------------------------------------------
  // task-slices kind
  // ---------------------------------------------------------------------------

  describe("task-slices kind", () => {
    test("extracts task from new_state with correct array index", () => {
      const plan = buildPlan({ "resources.jobs.etl": JOB_ENTRY });
      const result = extractRawPlanSlice(plan, buildTaskData("resources.jobs.etl", "load"));

      expect(result?.kind).toBe("task-slices");
      if (result?.kind === "task-slices") {
        const newStateSlice = result.slices.find((s) => s.label.startsWith("new_state"));
        expect(newStateSlice).toBeDefined();
        expect(newStateSlice?.label).toBe("new_state.value.tasks[1]");
        expect(newStateSlice?.data).toEqual({
          task_key: "load",
          depends_on: [{ task_key: "extract" }],
        });
      }
    });

    test("extracts task from remote_state with correct array index", () => {
      const plan = buildPlan({ "resources.jobs.etl": JOB_ENTRY });
      const result = extractRawPlanSlice(plan, buildTaskData("resources.jobs.etl", "extract"));

      expect(result?.kind).toBe("task-slices");
      if (result?.kind === "task-slices") {
        const remoteSlice = result.slices.find((s) => s.label.startsWith("remote_state"));
        expect(remoteSlice).toBeDefined();
        expect(remoteSlice?.label).toBe("remote_state.tasks[0]");
        expect(remoteSlice?.data).toEqual({
          task_key: "extract",
          notebook_task: { notebook_path: "/extract_old" },
        });
      }
    });

    test("filters changes to task-specific keys", () => {
      const plan = buildPlan({ "resources.jobs.etl": JOB_ENTRY });
      const result = extractRawPlanSlice(plan, buildTaskData("resources.jobs.etl", "extract"));

      expect(result?.kind).toBe("task-slices");
      if (result?.kind === "task-slices") {
        const changesSlice = result.slices.find((s) => s.label.startsWith("changes"));
        expect(changesSlice).toBeDefined();
        expect(changesSlice?.label).toBe("changes (filtered to tasks[task_key='extract'])");
        const data = changesSlice?.data as Record<string, unknown>;
        expect(Object.keys(data)).toEqual([
          "tasks[task_key='extract'].notebook_task.notebook_path",
        ]);
      }
    });

    test("returns all three slices when task has new_state, remote_state, and changes", () => {
      const plan = buildPlan({ "resources.jobs.etl": JOB_ENTRY });
      const result = extractRawPlanSlice(plan, buildTaskData("resources.jobs.etl", "extract"));

      expect(result?.kind).toBe("task-slices");
      if (result?.kind === "task-slices") {
        expect(result.slices).toHaveLength(3);
        expect(result.slices[0]?.label).toStartWith("new_state");
        expect(result.slices[1]?.label).toStartWith("remote_state");
        expect(result.slices[2]?.label).toStartWith("changes");
      }
    });

    test("omits remote_state slice when task not in remote_state", () => {
      const plan = buildPlan({ "resources.jobs.etl": JOB_ENTRY });
      const result = extractRawPlanSlice(plan, buildTaskData("resources.jobs.etl", "load"));

      expect(result?.kind).toBe("task-slices");
      if (result?.kind === "task-slices") {
        const labels = result.slices.map((s) => s.label);
        expect(labels.some((l) => l.startsWith("remote_state"))).toBe(false);
      }
    });

    test("omits changes slice when no changes match the task", () => {
      const entry: PlanEntry = {
        action: "create",
        new_state: { value: { tasks: [{ task_key: "only_task" }] } },
      };
      const plan = buildPlan({ "resources.jobs.j": entry });
      const result = extractRawPlanSlice(plan, buildTaskData("resources.jobs.j", "only_task"));

      expect(result?.kind).toBe("task-slices");
      if (result?.kind === "task-slices") {
        const labels = result.slices.map((s) => s.label);
        expect(labels.some((l) => l.startsWith("changes"))).toBe(false);
      }
    });

    test("returns undefined when task not found anywhere", () => {
      const plan = buildPlan({ "resources.jobs.etl": JOB_ENTRY });
      const result = extractRawPlanSlice(
        plan,
        buildTaskData("resources.jobs.etl", "nonexistent_task"),
      );

      expect(result).toBeUndefined();
    });

    test("handles entry with no new_state", () => {
      const entry: PlanEntry = { action: "delete", remote_state: { tasks: [{ task_key: "t" }] } };
      const plan = buildPlan({ "resources.jobs.j": entry });
      const result = extractRawPlanSlice(plan, buildTaskData("resources.jobs.j", "t"));

      expect(result?.kind).toBe("task-slices");
      if (result?.kind === "task-slices") {
        expect(result.slices).toHaveLength(1);
        expect(result.slices[0]?.label).toStartWith("remote_state");
      }
    });

    test("handles entry with no remote_state", () => {
      const entry: PlanEntry = {
        action: "create",
        new_state: { value: { tasks: [{ task_key: "t" }] } },
      };
      const plan = buildPlan({ "resources.jobs.j": entry });
      const result = extractRawPlanSlice(plan, buildTaskData("resources.jobs.j", "t"));

      expect(result?.kind).toBe("task-slices");
      if (result?.kind === "task-slices") {
        expect(result.slices).toHaveLength(1);
        expect(result.slices[0]?.label).toStartWith("new_state");
      }
    });

    test("handles new_state without value field", () => {
      const entry: PlanEntry = { action: "update", new_state: { vars: {} } };
      const plan = buildPlan({ "resources.jobs.j": entry });
      const result = extractRawPlanSlice(plan, buildTaskData("resources.jobs.j", "t"));

      expect(result).toBeUndefined();
    });

    test("handles new_state.value without tasks field", () => {
      const entry: PlanEntry = { action: "update", new_state: { value: { name: "job" } } };
      const plan = buildPlan({ "resources.jobs.j": entry });
      const result = extractRawPlanSlice(plan, buildTaskData("resources.jobs.j", "t"));

      expect(result).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // fixture integration
  // ---------------------------------------------------------------------------

  describe("with real fixtures", () => {
    const loadFixture = async (name: string): Promise<Plan> => {
      const text = await Bun.file(`../fixtures/golden/${name}/plan.json`).text();
      const { parsePlanJson } = await import("../../src/parser/parse-plan.ts");
      const result = parsePlanJson(JSON.parse(text));
      if (!result.ok) throw new Error(`Fixture parse failed: ${result.error}`);
      return result.data;
    };

    test("mixed-changes: resource entry matches fixture data", async () => {
      const plan = await loadFixture("mixed-changes");
      const result = extractRawPlanSlice(
        plan,
        buildResourceData("resources.alerts.stale_pipeline_alert"),
      );

      expect(result?.kind).toBe("entry");
      if (result?.kind === "entry") {
        const data = result.data as Record<string, unknown>;
        expect(data["action"]).toBe("update");
      }
    });

    test("sub-resources-plan: job with permissions returns entry-with-subs", async () => {
      const plan = await loadFixture("sub-resources");
      const result = extractRawPlanSlice(plan, buildResourceData("resources.jobs.job_perm_change"));

      expect(result?.kind).toBe("entry-with-subs");
      if (result?.kind === "entry-with-subs") {
        expect([...result.entries.keys()]).toEqual([
          "resources.jobs.job_perm_change",
          "resources.jobs.job_perm_change.permissions",
        ]);
      }
    });

    test("sub-resources-plan: task from job with sub-resources returns slices", async () => {
      const plan = await loadFixture("sub-resources");
      const result = extractRawPlanSlice(
        plan,
        buildTaskData("resources.jobs.job_perm_change", "run"),
      );

      expect(result?.kind).toBe("task-slices");
      if (result?.kind === "task-slices") {
        expect(result.slices.length).toBeGreaterThan(0);
        expect(result.slices[0]?.label).toBe("new_state.value.tasks[0]");
      }
    });
  });
});
