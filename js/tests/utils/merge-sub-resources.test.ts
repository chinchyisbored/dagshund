import { describe, expect, test } from "bun:test";
import type { PlanEntry } from "../../src/types/plan-schema.ts";
import { mergeSubResources } from "../../src/utils/merge-sub-resources.ts";
import { filterJobLevelChanges } from "../../src/utils/task-key.ts";

describe("mergeSubResources", () => {
  test("returns entries unchanged when no sub-resources present", () => {
    const entries: Record<string, PlanEntry> = {
      "resources.jobs.my_job": { action: "create" },
      "resources.schemas.analytics": { action: "skip" },
    };

    const result = mergeSubResources(entries);

    expect(Object.keys(result).sort()).toEqual([
      "resources.jobs.my_job",
      "resources.schemas.analytics",
    ]);
    expect(result["resources.jobs.my_job"]).toEqual({ action: "create" });
  });

  test("prefixes sub-resource changes with suffix", () => {
    const entries: Record<string, PlanEntry> = {
      "resources.schemas.analytics": { action: "skip" },
      "resources.schemas.analytics.grants": {
        action: "update",
        changes: {
          "grants[principal='data_team'].privileges": {
            action: "update",
            old: ["USE_SCHEMA"],
            new: ["USE_SCHEMA", "CREATE_TABLE"],
          },
        },
      },
    };

    const result = mergeSubResources(entries);

    expect(result["resources.schemas.analytics"]?.changes).toEqual({
      "grants.grants[principal='data_team'].privileges": {
        action: "update",
        old: ["USE_SCHEMA"],
        new: ["USE_SCHEMA", "CREATE_TABLE"],
      },
    });
  });

  test("injects sub-resource state under suffix key in parent new_state", () => {
    const entries: Record<string, PlanEntry> = {
      "resources.jobs.my_job": {
        action: "create",
        new_state: { value: { name: "my_job", format: "MULTI_TASK" } },
      },
      "resources.jobs.my_job.permissions": {
        action: "skip",
        new_state: {
          value: {
            object_id: "/jobs/123",
            permissions: [{ group_name: "admins", permission_level: "CAN_MANAGE" }],
          },
        },
      },
    };

    const result = mergeSubResources(entries);
    const merged = result["resources.jobs.my_job"];
    expect(merged).toBeDefined();
    const newState = merged?.new_state as { value: Record<string, unknown> } | undefined;
    expect(newState).toBeDefined();
    // biome-ignore lint/style/noNonNullAssertion: guarded by toBeDefined() assertion above
    const value = newState!.value;

    expect(value["permissions"]).toEqual({
      object_id: "/jobs/123",
      permissions: [{ group_name: "admins", permission_level: "CAN_MANAGE" }],
    });
    // Original fields preserved
    expect(value["name"]).toBe("my_job");
  });

  test("injects sub-resource remote_state under suffix key in parent", () => {
    const entries: Record<string, PlanEntry> = {
      "resources.jobs.my_job": {
        action: "skip",
        remote_state: { name: "my_job", job_id: 123 },
      },
      "resources.jobs.my_job.permissions": {
        action: "skip",
        remote_state: {
          object_id: "/jobs/123",
          permissions: [{ group_name: "devs", permission_level: "CAN_VIEW" }],
        },
      },
    };

    const result = mergeSubResources(entries);
    const remote = result["resources.jobs.my_job"]?.remote_state as Record<string, unknown>;

    expect(remote["permissions"]).toEqual({
      object_id: "/jobs/123",
      permissions: [{ group_name: "devs", permission_level: "CAN_VIEW" }],
    });
    expect(remote["name"]).toBe("my_job");
  });

  test("promotes skip parent to update when sub has update action", () => {
    const entries: Record<string, PlanEntry> = {
      "resources.schemas.analytics": { action: "skip" },
      "resources.schemas.analytics.grants": {
        action: "update",
        changes: {
          "grants[principal='data_team'].privileges": {
            action: "update",
            old: ["USE_SCHEMA"],
            new: ["USE_SCHEMA", "CREATE_TABLE"],
          },
        },
      },
    };

    const result = mergeSubResources(entries);

    expect(result["resources.schemas.analytics"]?.action).toBe("update");
  });

  test("keeps parent action when parent already has non-skip action", () => {
    const entries: Record<string, PlanEntry> = {
      "resources.schemas.analytics": { action: "create" },
      "resources.schemas.analytics.grants": { action: "update" },
    };

    const result = mergeSubResources(entries);

    expect(result["resources.schemas.analytics"]?.action).toBe("create");
  });

  test("merges external depends_on and drops self-referential entries", () => {
    const entries: Record<string, PlanEntry> = {
      "resources.jobs.my_job": {
        action: "create",
        depends_on: [{ node: "resources.schemas.analytics" }],
      },
      "resources.jobs.my_job.permissions": {
        action: "skip",
        depends_on: [
          { node: "resources.jobs.my_job" }, // self-referential — dropped
          { node: "resources.schemas.other" }, // external — kept
        ],
      },
    };

    const result = mergeSubResources(entries);
    const deps = result["resources.jobs.my_job"]?.depends_on;

    expect(deps).toHaveLength(2);
    expect(deps?.map((d) => d.node)).toEqual([
      "resources.schemas.analytics",
      "resources.schemas.other",
    ]);
  });

  test("rewrites sub-resource-key targets in depends_on to parent keys", () => {
    const entries: Record<string, PlanEntry> = {
      "resources.jobs.job_a": { action: "create" },
      "resources.jobs.job_a.permissions": {
        action: "skip",
        depends_on: [
          { node: "resources.jobs.job_a" },
          { node: "resources.jobs.job_b.permissions" }, // sub-key target → rewritten
        ],
      },
      "resources.jobs.job_b": { action: "skip" },
      "resources.jobs.job_b.permissions": {
        action: "skip",
        depends_on: [{ node: "resources.jobs.job_b" }],
      },
    };

    const result = mergeSubResources(entries);
    const deps = result["resources.jobs.job_a"]?.depends_on;

    expect(deps).toHaveLength(1);
    expect(deps?.[0]?.node).toBe("resources.jobs.job_b");
  });

  test("keeps orphan sub-resources as standalone entries", () => {
    const entries: Record<string, PlanEntry> = {
      "resources.jobs.orphan_job.permissions": { action: "skip" },
    };

    const result = mergeSubResources(entries);

    expect(Object.keys(result)).toEqual(["resources.jobs.orphan_job.permissions"]);
  });

  test("merges multiple sub-resources on same parent", () => {
    const entries: Record<string, PlanEntry> = {
      "resources.schemas.analytics": { action: "skip" },
      "resources.schemas.analytics.grants": {
        action: "update",
        changes: {
          "grants[principal='data_team'].privileges": {
            action: "update",
            old: ["USE_SCHEMA"],
            new: ["USE_SCHEMA", "CREATE_TABLE"],
          },
        },
        remote_state: {
          securable_type: "SCHEMA",
          full_name: "main.analytics",
          grants: [{ principal: "data_team", privileges: ["USE_SCHEMA"] }],
        },
      },
      "resources.schemas.analytics.permissions": {
        action: "skip",
        remote_state: { object_id: "/schemas/456", permissions: [] },
      },
    };

    const result = mergeSubResources(entries);

    // Only parent key remains
    const keys = Object.keys(result);
    expect(keys).toEqual(["resources.schemas.analytics"]);
    const merged = result["resources.schemas.analytics"];
    // Action promoted from skip
    expect(merged?.action).toBe("update");
    // Both sub-resources' states injected
    const remote = merged?.remote_state as Record<string, unknown>;
    expect(remote["grants"]).toBeDefined();
    expect(remote["permissions"]).toBeDefined();
    // Changes from grants prefixed
    expect(merged?.changes?.["grants.grants[principal='data_team'].privileges"]).toBeDefined();
  });

  test("synthesizes whole-field change for delete sub with no field changes", () => {
    const entries: Record<string, PlanEntry> = {
      "resources.jobs.my_job": {
        action: "skip",
        remote_state: { name: "my_job" },
      },
      "resources.jobs.my_job.permissions": {
        action: "delete",
        remote_state: {
          object_id: "/jobs/123",
          permissions: [{ group_name: "users", permission_level: "CAN_VIEW" }],
        },
      },
    };

    const result = mergeSubResources(entries);
    const merged = result["resources.jobs.my_job"];

    expect(merged?.action).toBe("update");
    expect(merged?.changes?.["permissions"]).toEqual({
      action: "delete",
      old: {
        object_id: "/jobs/123",
        permissions: [{ group_name: "users", permission_level: "CAN_VIEW" }],
      },
    });
  });

  test("synthesizes whole-field change for create sub with no field changes", () => {
    const entries: Record<string, PlanEntry> = {
      "resources.jobs.my_job": {
        action: "create",
        new_state: { value: { name: "my_job" } },
      },
      "resources.jobs.my_job.permissions": {
        action: "create",
        new_state: {
          value: {
            object_id: "/jobs/123",
            permissions: [{ group_name: "admins", permission_level: "CAN_MANAGE" }],
          },
        },
      },
    };

    const result = mergeSubResources(entries);
    const merged = result["resources.jobs.my_job"];

    expect(merged?.action).toBe("create");
    expect(merged?.changes?.["permissions"]).toEqual({
      action: "create",
      new: {
        object_id: "/jobs/123",
        permissions: [{ group_name: "admins", permission_level: "CAN_MANAGE" }],
      },
    });
  });

  test("does not synthesize whole-field change when sub has field-level changes", () => {
    const entries: Record<string, PlanEntry> = {
      "resources.jobs.my_job": { action: "skip" },
      "resources.jobs.my_job.permissions": {
        action: "update",
        changes: {
          "permissions[group_name='users'].permission_level": {
            action: "update",
            old: "CAN_VIEW",
            new: "CAN_MANAGE",
          },
        },
      },
    };

    const result = mergeSubResources(entries);
    const merged = result["resources.jobs.my_job"];

    // Should use prefixed changes, not synthesized whole-field
    expect(merged?.changes?.["permissions"]).toBeUndefined();
    expect(
      merged?.changes?.["permissions.permissions[group_name='users'].permission_level"],
    ).toBeDefined();
  });

  test("prefixed changes survive filterJobLevelChanges", () => {
    const entries: Record<string, PlanEntry> = {
      "resources.jobs.my_job": { action: "skip" },
      "resources.jobs.my_job.permissions": {
        action: "update",
        changes: {
          "permissions[group_name='users'].permission_level": {
            action: "update",
            old: "CAN_VIEW",
            new: "CAN_MANAGE",
          },
        },
      },
    };

    const result = mergeSubResources(entries);
    const jobLevelChanges = filterJobLevelChanges(result["resources.jobs.my_job"]?.changes);

    // Prefixed changes don't start with "tasks[" so they pass through
    expect(jobLevelChanges).toBeDefined();
    expect(
      jobLevelChanges?.["permissions.permissions[group_name='users'].permission_level"],
    ).toBeDefined();
  });
});
