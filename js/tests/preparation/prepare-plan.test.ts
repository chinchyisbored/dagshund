import { describe, expect, test } from "bun:test";
import { buildResourceGraph } from "../../src/graph/build-resource-graph.ts";
import { parsePlanJson } from "../../src/parser/parse-plan.ts";
import { preparePlan } from "../../src/preparation/prepare-plan.ts";
import { normalizePlan } from "../../src/utils/normalize-plan.ts";
import { buildResourceGraphFromPlan } from "../helpers/build-graphs-from-plan.ts";

const prepareEntries = (entries: Readonly<Record<string, unknown>>) => {
  const parsed = parsePlanJson({ plan: entries });
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw new Error("test plan must parse");
  return preparePlan(normalizePlan(parsed.data.plan ?? {}));
};

describe("preparePlan job file-arrival references", () => {
  test("collects safe diagnostics for malformed selected trigger containers", () => {
    const prepared = prepareEntries({
      "resources.jobs.valid": {
        action: "create",
        new_state: {
          value: { trigger: { file_arrival: { url: "/Volumes/main/analytics/shared" } } },
        },
      },
      "resources.jobs.malformed": {
        action: "create",
        new_state: { value: { trigger: { file_arrival: "PRIVATE" } } },
      },
    });

    expect(prepared.byResourceKey.get("resources.jobs.valid")?.job).toMatchObject({
      value: { fileArrivalUrl: { status: "supported", value: "/Volumes/main/analytics/shared" } },
    });
    expect(prepared.diagnostics).toEqual([
      {
        resourceKey: "resources.jobs.malformed",
        capability: "job-file-arrival",
        reason: "invalid-shape",
      },
    ]);
    expect(JSON.stringify(prepared.diagnostics)).not.toContain("PRIVATE");
  });
});

describe("preparePlan app resource projections", () => {
  test("prepares known variants while leaving unknown variants opaque", () => {
    const prepared = prepareEntries({
      "resources.apps.valid": {
        action: "create",
        new_state: {
          value: {
            resources: [
              { job: { id: "job-1", permission: "CAN_RUN" } },
              { secret: { scope: "scope-1", key: "token" } },
              {
                postgres: {
                  branch: "projects/demo/branches/main",
                  database: "projects/demo/branches/main/databases/session",
                  permission: "CAN_CONNECT_AND_CREATE",
                },
              },
              { future_variant: { credential: "PRIVATE" } },
            ],
          },
        },
      },
      "resources.apps.unknown": {
        action: "create",
        new_state: { value: { resources: [{ future_variant: { credential: "PRIVATE" } }] } },
      },
    });

    expect(prepared.byResourceKey.get("resources.apps.valid")?.appResources).toEqual({
      status: "supported",
      value: [
        { kind: "job", id: "job-1" },
        { kind: "secret_scope", name: "scope-1" },
        {
          kind: "postgres",
          branch: "projects/demo/branches/main",
          database: "projects/demo/branches/main/databases/session",
        },
      ],
    });
    expect(prepared.byResourceKey.get("resources.apps.unknown")?.appResources).toEqual({
      status: "supported",
      value: [],
    });
    expect(prepared.diagnostics).toEqual([]);
  });

  test("diagnoses malformed Postgres variants without exposing their values", () => {
    const prepared = prepareEntries({
      "resources.apps.malformed": {
        action: "create",
        new_state: { value: { resources: [{ postgres: { branch: "valid", database: 42 } }] } },
      },
    });

    expect(prepared.byResourceKey.get("resources.apps.malformed")?.appResources.status).toBe(
      "unsupported",
    );
    expect(prepared.diagnostics).toEqual([
      {
        resourceKey: "resources.apps.malformed",
        capability: "app-resources",
        reason: "invalid-shape",
      },
    ]);
    expect(buildResourceGraph(prepared).lateralEdges).toEqual([]);
  });

  test("diagnoses malformed recognized variants without exposing their values", () => {
    const prepared = prepareEntries({
      "resources.apps.malformed": {
        action: "create",
        new_state: { value: { resources: [{ job: { id: 42, secret: "PRIVATE" } }] } },
      },
    });

    expect(prepared.byResourceKey.get("resources.apps.malformed")?.appResources.status).toBe(
      "unsupported",
    );
    expect(prepared.diagnostics).toEqual([
      {
        resourceKey: "resources.apps.malformed",
        capability: "app-resources",
        reason: "invalid-shape",
      },
    ]);
    expect(JSON.stringify(prepared.diagnostics)).not.toContain("PRIVATE");
    expect(buildResourceGraph(prepared).lateralEdges).toEqual([]);
  });
});

describe("preparePlan typed app securables", () => {
  test("leaves unknown UC securable types opaque", () => {
    const prepared = prepareEntries({
      "resources.apps.app": {
        action: "create",
        new_state: {
          value: {
            resources: [{ uc_securable: { securable_type: "FUTURE", credential: "PRIVATE" } }],
          },
        },
      },
    });

    expect(prepared.byResourceKey.get("resources.apps.app")?.appResources).toEqual({
      status: "supported",
      value: [],
    });
    expect(JSON.stringify(prepared.diagnostics)).not.toContain("PRIVATE");
  });

  test("retains supported UC securable discriminants including deferred CONNECTION", () => {
    const prepared = prepareEntries({
      "resources.apps.app": {
        action: "create",
        new_state: {
          value: {
            resources: [
              ...(["TABLE", "VOLUME", "FUNCTION", "CONNECTION"] as const).map((securable_type) => ({
                uc_securable: { securable_type, securable_full_name: "main.analytics.shared" },
              })),
            ],
          },
        },
      },
    });

    expect(prepared.byResourceKey.get("resources.apps.app")?.appResources).toEqual({
      status: "supported",
      value: (["TABLE", "VOLUME", "FUNCTION", "CONNECTION"] as const).map((securableType) => ({
        kind: "uc_securable",
        fullName: "main.analytics.shared",
        securableType,
      })),
    });
  });

  test("diagnoses malformed UC securable types without exposing values", () => {
    const prepared = prepareEntries({
      "resources.apps.app": {
        action: "create",
        new_state: {
          value: {
            resources: [
              {
                uc_securable: { securable_type: 42, securable_full_name: "main.analytics.shared" },
              },
            ],
          },
        },
      },
    });

    expect(prepared.byResourceKey.get("resources.apps.app")?.appResources).toMatchObject({
      status: "unsupported",
      diagnostic: { capability: "app-resources", reason: "invalid-shape" },
    });
    expect(JSON.stringify(prepared.diagnostics)).not.toContain("42");
  });

  test("diagnoses a missing recognized UC securable type", () => {
    const prepared = prepareEntries({
      "resources.apps.app": {
        action: "create",
        new_state: {
          value: { resources: [{ uc_securable: { securable_full_name: "main.schema.table" } }] },
        },
      },
    });

    expect(prepared.byResourceKey.get("resources.apps.app")?.appResources).toMatchObject({
      status: "unsupported",
      diagnostic: { capability: "app-resources", reason: "invalid-shape" },
    });
  });
});

describe("preparePlan specialized reference projections", () => {
  test("ignores Postgres fields not consumed by the resource family", () => {
    const prepared = prepareEntries({
      "resources.postgres_branches.main": {
        action: "create",
        new_state: {
          value: { branch_id: "main", parent: "projects/demo", role: { unknown: "opaque" } },
        },
      },
    });

    expect(prepared.byResourceKey.get("resources.postgres_branches.main")?.postgres).toEqual({
      status: "supported",
      value: { branch_id: "main", parent: "projects/demo" },
    });
    expect(prepared.diagnostics).toEqual([]);
  });

  test("prepares ingestion schemas and derived output identities with safe diagnostics", () => {
    const prepared = prepareEntries({
      "resources.pipelines.valid": {
        action: "create",
        new_state: {
          value: {
            ingestion_definition: {
              objects: [{ schema: { source_catalog: "main", source_schema: "raw" } }],
            },
            event_log: { catalog: "main", schema: "ops", name: "events" },
          },
        },
      },
      "resources.postgres_synced_tables.valid": {
        action: "create",
        new_state: {
          value: { source_table_full_name: "main.raw.source", synced_table_id: "main.out.copy" },
        },
      },
      "resources.pipelines.malformed": {
        action: "create",
        new_state: {
          value: {
            ingestion_definition: {
              objects: [{ schema: { source_catalog: 7, token: "PRIVATE" } }],
            },
          },
        },
      },
    });

    expect(
      prepared.byResourceKey.get("resources.pipelines.valid")?.pipelineIngestionSchemas,
    ).toEqual({
      status: "supported",
      value: ["main.raw"],
    });
    expect(prepared.byResourceKey.get("resources.pipelines.valid")?.pipelineEventLog).toEqual({
      status: "supported",
      value: { catalog: "main", schema: "ops", name: "events" },
    });
    expect(
      prepared.byResourceKey.get("resources.postgres_synced_tables.valid")?.sourceTableFullName,
    ).toEqual({
      status: "supported",
      value: "main.raw.source",
    });
    expect(
      prepared.byResourceKey.get("resources.postgres_synced_tables.valid")?.syncedTableId,
    ).toEqual({
      status: "supported",
      value: "main.out.copy",
    });
    expect(prepared.diagnostics).toContainEqual({
      resourceKey: "resources.pipelines.malformed",
      capability: "pipeline-ingestion-schemas",
      reason: "invalid-shape",
    });
    expect(JSON.stringify(prepared.diagnostics)).not.toContain("PRIVATE");
  });

  test("does not mutate source plan data while projecting references", () => {
    const entries = {
      "resources.pipelines.pipeline": {
        action: "create",
        new_state: {
          value: {
            ingestion_definition: {
              objects: [{ schema: { source_catalog: "main", source_schema: "raw" } }],
            },
          },
        },
      },
    };
    const original = structuredClone(entries);

    prepareEntries(entries);

    expect(entries).toEqual(original);
  });
});

describe("preparePlan skipped Postgres configured references", () => {
  test("recovers only equal input-only facts for skipped entries without new state", () => {
    const prepared = prepareEntries({
      "resources.postgres_synced_tables.lookup": {
        action: "skip",
        remote_state: { id: "remote-id", status: { state: "ACTIVE" } },
        changes: {
          source_table_full_name: {
            action: "skip",
            reason: "spec:input_only",
            old: "dagshund.sources.lookup",
            new: "dagshund.sources.lookup",
          },
          branch: {
            action: "skip",
            reason: "spec:input_only",
            old: "projects/demo/branches/main",
            new: "projects/demo/branches/main",
          },
          postgres_database: {
            action: "skip",
            reason: "spec:input_only",
            old: "lookup",
            new: "lookup",
          },
        },
      },
      "resources.postgres_synced_tables.changed": {
        action: "skip",
        remote_state: { id: "remote-id" },
        new_state: { value: {} },
        changes: {
          source_table_full_name: {
            action: "skip",
            reason: "spec:input_only",
            old: "dagshund.sources.stale",
            new: "dagshund.sources.stale",
          },
        },
      },
    });

    expect(
      prepared.byResourceKey.get("resources.postgres_synced_tables.lookup")?.sourceTableFullName,
    ).toEqual({ status: "supported", value: "dagshund.sources.lookup" });
    expect(prepared.byResourceKey.get("resources.postgres_synced_tables.lookup")?.postgres).toEqual(
      {
        status: "supported",
        value: {
          branch: "projects/demo/branches/main",
          postgres_database: "lookup",
        },
      },
    );
    expect(
      prepared.byResourceKey.get("resources.postgres_synced_tables.changed")?.sourceTableFullName,
    ).toEqual({ status: "absent" });
  });

  test("preserves unsupported current projections and explicit source-field presence", () => {
    const entry = {
      action: "skip",
      remote_state: {
        id: "remote-id",
        source_table_full_name: null,
        branch: 42,
        postgres_database: "current_db",
        status: { postgres_database: null },
      },
      changes: {
        source_table_full_name: {
          action: "skip",
          reason: "spec:input_only",
          old: "dagshund.sources.stale",
          new: "dagshund.sources.stale",
        },
        branch: {
          action: "skip",
          reason: "spec:input_only",
          old: "projects/demo/branches/main",
          new: "projects/demo/branches/main",
        },
        postgres_database: {
          action: "skip",
          reason: "spec:input_only",
          old: "old_db",
          new: "old_db",
        },
      },
    } as const;
    const prepared = prepareEntries({ "resources.postgres_synced_tables.lookup": entry });
    const resource = prepared.byResourceKey.get("resources.postgres_synced_tables.lookup");
    expect(resource?.sourceTableFullName.status).toBe("absent");
    expect(resource?.postgres.status).toBe("unsupported");
    expect(prepared.diagnostics).toContainEqual({
      resourceKey: "resources.postgres_synced_tables.lookup",
      capability: "postgres-identity",
      reason: "invalid-shape",
    });

    const graph = buildResourceGraphFromPlan({
      plan: { "resources.postgres_synced_tables.lookup": entry },
    });
    expect(
      graph.lateralEdges.some((edge) => edge.target === "source-table::dagshund.sources.stale"),
    ).toBe(false);
    expect(
      graph.edges.some(
        (edge) =>
          edge.source === "postgres-root" &&
          edge.target === "resources.postgres_synced_tables.lookup",
      ),
    ).toBe(true);
  });

  test("current source values and explicit spec overrides take precedence over history", () => {
    for (const [name, current, expectedStatus] of [
      ["supported", "cat.current.table", "supported"],
      ["empty", "", "supported"],
      ["invalid", 42, "unsupported"],
      ["null", null, "absent"],
    ] as const) {
      const prepared = prepareEntries({
        [`resources.postgres_synced_tables.${name}`]: {
          action: "skip",
          remote_state: { id: "remote-id", source_table_full_name: current },
          changes: {
            source_table_full_name: {
              action: "skip",
              reason: "spec:input_only",
              old: "cat.history.table",
              new: "cat.history.table",
            },
          },
        },
      });
      expect(
        prepared.byResourceKey.get(`resources.postgres_synced_tables.${name}`)?.sourceTableFullName
          .status,
      ).toBe(expectedStatus);
    }

    const specOverride = prepareEntries({
      "resources.postgres_synced_tables.spec_override": {
        action: "skip",
        remote_state: {
          id: "remote-id",
          spec: { source_table_full_name: "cat.current.table" },
        },
        changes: {
          source_table_full_name: {
            action: "skip",
            reason: "spec:input_only",
            old: "cat.history.table",
            new: "cat.history.table",
          },
        },
      },
    });
    expect(
      specOverride.byResourceKey.get("resources.postgres_synced_tables.spec_override")
        ?.sourceTableFullName,
    ).toEqual({ status: "supported", value: "cat.current.table" });

    const nullishDirectWithSpec = prepareEntries({
      "resources.postgres_synced_tables.nullish_direct": {
        action: "create",
        new_state: {
          value: {
            source_table_full_name: null,
            spec: { source_table_full_name: "cat.raw.current" },
          },
        },
      },
    });
    expect(
      nullishDirectWithSpec.byResourceKey.get("resources.postgres_synced_tables.nullish_direct")
        ?.sourceTableFullName,
    ).toEqual({ status: "supported", value: "cat.raw.current" });
  });

  test("current Postgres branch and database values take precedence over configured history", () => {
    const prepared = prepareEntries({
      "resources.postgres_synced_tables.current": {
        action: "skip",
        remote_state: {
          id: "remote-id",
          branch: "projects/current/branches/branch",
          postgres_database: "current_db",
        },
        changes: {
          branch: {
            action: "skip",
            reason: "spec:input_only",
            old: "projects/history/branches/branch",
            new: "projects/history/branches/branch",
          },
          postgres_database: {
            action: "skip",
            reason: "spec:input_only",
            old: "history_db",
            new: "history_db",
          },
        },
      },
    });

    expect(
      prepared.byResourceKey.get("resources.postgres_synced_tables.current")?.postgres,
    ).toEqual({
      status: "supported",
      value: {
        branch: "projects/current/branches/branch",
        postgres_database: "current_db",
      },
    });
  });

  test("does not repair empty or invalid current branch and database overrides", () => {
    const cases = [
      {
        remote_state: { id: "remote-id", branch: "", postgres_database: "current_db" },
        expectedStatus: "supported",
        expectedValue: { branch: "", postgres_database: "current_db" },
      },
      {
        remote_state: {
          id: "remote-id",
          branch: "projects/current/branches/main",
          postgres_database: "",
        },
        expectedStatus: "supported",
        expectedValue: { branch: "projects/current/branches/main", postgres_database: "" },
      },
      {
        remote_state: {
          id: "remote-id",
          branch: "projects/current/branches/main",
          postgres_database: 42,
        },
        expectedStatus: "unsupported",
      },
      {
        remote_state: {
          id: "remote-id",
          branch: "projects/current/branches/main",
          status: { postgres_database: null },
        },
        expectedStatus: "unsupported",
      },
    ] as const;

    for (const [index, testCase] of cases.entries()) {
      const entry = {
        action: "skip",
        remote_state: testCase.remote_state,
        changes: {
          branch: {
            action: "skip",
            reason: "spec:input_only",
            old: "projects/history/branches/main",
            new: "projects/history/branches/main",
          },
          postgres_database: {
            action: "skip",
            reason: "spec:input_only",
            old: "history_db",
            new: "history_db",
          },
        },
      } as const;
      const key = `resources.postgres_synced_tables.override_${index}`;
      const prepared = prepareEntries({ [key]: entry });
      const postgres = prepared.byResourceKey.get(key)?.postgres;
      expect(postgres?.status).toBe(testCase.expectedStatus);
      if (testCase.expectedStatus === "supported") {
        expect(postgres).toEqual({ status: "supported", value: testCase.expectedValue });
      }

      const graph = buildResourceGraphFromPlan({ plan: { [key]: entry } });
      expect(graph.nodes.some((node) => node.id.includes("history_db"))).toBe(false);
      expect(graph.nodes.some((node) => node.id.includes("history/branches/main"))).toBe(false);
      expect(graph.lateralEdges.some((edge) => edge.target.includes("history_db"))).toBe(false);
      expect(graph.edges.some((edge) => edge.target.includes("history/branches/main"))).toBe(false);
    }
  });

  test("reports malformed equal configured values without exposing them or discarding current fields", () => {
    const malformedRecord = { private: "PRIVATE" };
    const malformedArray = ["PRIVATE"];
    const prepared = prepareEntries({
      "resources.postgres_synced_tables.lookup": {
        action: "skip",
        remote_state: { id: "remote-id", branch: "projects/current/branches/main" },
        changes: {
          source_table_full_name: {
            action: "skip",
            reason: "spec:input_only",
            old: malformedArray,
            new: ["PRIVATE"],
          },
          branch: {
            action: "skip",
            reason: "spec:input_only",
            old: "",
            new: "",
          },
          postgres_database: {
            action: "skip",
            reason: "spec:input_only",
            old: malformedRecord,
            new: { private: "PRIVATE" },
          },
        },
      },
    });
    const resource = prepared.byResourceKey.get("resources.postgres_synced_tables.lookup");
    expect(resource?.sourceTableFullName.status).toBe("unsupported");
    expect(resource?.postgres).toEqual({
      status: "supported",
      value: { branch: "projects/current/branches/main" },
    });
    expect(prepared.diagnostics).toContainEqual({
      resourceKey: "resources.postgres_synced_tables.lookup",
      capability: "postgres-synced-table-configured-inputs",
      reason: "invalid-shape",
    });
    expect(JSON.stringify(prepared.diagnostics)).not.toContain("42");
    expect(JSON.stringify(prepared.diagnostics)).not.toContain("projects/current");
  });

  test("rejects ineligible and malformed history facts while accepting only exact equal input-only values", () => {
    const remote = { id: "remote-id" };
    const fact = {
      action: "skip",
      reason: "spec:input_only",
      old: "cat.schema.table",
      new: "cat.schema.table",
    };
    const prepared = prepareEntries({
      "resources.postgres_synced_tables.accepted": {
        action: "skip",
        remote_state: remote,
        changes: { source_table_full_name: fact },
      },
      "resources.postgres_synced_tables.wrong_reason": {
        action: "skip",
        remote_state: remote,
        changes: { source_table_full_name: { ...fact, reason: "other" } },
      },
      "resources.postgres_synced_tables.wrong_action": {
        action: "skip",
        remote_state: remote,
        changes: { source_table_full_name: { ...fact, action: "update" } },
      },
      "resources.postgres_synced_tables.unequal": {
        action: "skip",
        remote_state: remote,
        changes: { source_table_full_name: { ...fact, new: "cat.schema.new" } },
      },
      "resources.postgres_synced_tables.absent_remote": {
        action: "skip",
        changes: { source_table_full_name: fact },
      },
      "resources.postgres_synced_tables.delete": {
        action: "delete",
        remote_state: remote,
        changes: { source_table_full_name: fact },
      },
      "resources.postgres_synced_tables.explicit_empty": {
        action: "skip",
        remote_state: remote,
        new_state: { value: {} },
        changes: { source_table_full_name: fact },
      },
      "resources.postgres_synced_tables.empty_remote": {
        action: "skip",
        remote_state: {},
        changes: { source_table_full_name: fact },
      },
      "resources.postgres_synced_tables.non_record_remote": {
        action: "skip",
        remote_state: "invalid",
        changes: { source_table_full_name: fact },
      },
      "resources.postgres_synced_tables.malformed_new": {
        action: "skip",
        remote_state: remote,
        new_state: { value: "invalid" },
        changes: { source_table_full_name: fact },
      },
      "resources.postgres_synced_tables.null_new": {
        action: "skip",
        remote_state: remote,
        new_state: null,
        changes: { source_table_full_name: fact },
      },
      "resources.postgres_synced_tables.create": {
        action: "create",
        remote_state: remote,
        changes: { source_table_full_name: fact },
      },
      "resources.postgres_synced_tables.update": {
        action: "update",
        remote_state: remote,
        changes: { source_table_full_name: fact },
      },
      "resources.postgres_synced_tables.recreate": {
        action: "recreate",
        remote_state: remote,
        changes: { source_table_full_name: fact },
      },
    });
    expect(
      prepared.byResourceKey.get("resources.postgres_synced_tables.accepted")?.sourceTableFullName,
    ).toEqual({
      status: "supported",
      value: "cat.schema.table",
    });
    for (const key of [
      "wrong_reason",
      "wrong_action",
      "unequal",
      "absent_remote",
      "empty_remote",
      "non_record_remote",
      "delete",
      "explicit_empty",
      "malformed_new",
      "null_new",
      "create",
      "update",
      "recreate",
    ]) {
      expect(
        prepared.byResourceKey.get(`resources.postgres_synced_tables.${key}`)?.sourceTableFullName,
      ).toEqual({ status: "absent" });
    }
  });

  test("resolves shared configured source identity independently across project hierarchies", () => {
    const fact = (value: string) =>
      ({
        action: "skip",
        reason: "spec:input_only",
        old: value,
        new: value,
      }) as const;
    const plan = {
      "resources.postgres_synced_tables.first": {
        action: "skip",
        remote_state: { id: "first-id" },
        changes: {
          source_table_full_name: fact("cat.schema.shared"),
          branch: fact("projects/first/branches/main"),
          postgres_database: fact("first_db"),
        },
      },
      "resources.postgres_synced_tables.second": {
        action: "skip",
        remote_state: { id: "second-id" },
        changes: {
          source_table_full_name: fact("cat.schema.shared"),
          branch: fact("projects/second/branches/main"),
          postgres_database: fact("second_db"),
        },
      },
    } as const;
    const graph = buildResourceGraphFromPlan({ plan });
    const sharedSource = graph.nodes.filter(
      (node) => node.id === "source-table::cat.schema.shared",
    );
    expect(sharedSource).toHaveLength(1);
    expect(
      graph.lateralEdges.filter((edge) => edge.target === "source-table::cat.schema.shared"),
    ).toHaveLength(2);
    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        source: "postgres-database::first/main/first_db",
        target: "resources.postgres_synced_tables.first",
      }),
    );
    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        source: "postgres-database::second/main/second_db",
        target: "resources.postgres_synced_tables.second",
      }),
    );
  });

  test("configured source references reuse an existing managed table identity", () => {
    const graph = buildResourceGraphFromPlan({
      plan: {
        "resources.synced_database_tables.existing": {
          action: "create",
          new_state: { value: { name: "cat.sch.existing_table" } },
        },
        "resources.postgres_synced_tables.lookup": {
          action: "skip",
          remote_state: { id: "remote-id" },
          changes: {
            source_table_full_name: {
              action: "skip",
              reason: "spec:input_only",
              old: "cat.sch.existing_table",
              new: "cat.sch.existing_table",
            },
          },
        },
      },
    });

    expect(graph.nodes.some((node) => node.id === "source-table::cat.sch.existing_table")).toBe(
      false,
    );
    expect(graph.lateralEdges).toContainEqual(
      expect.objectContaining({
        source: "resources.postgres_synced_tables.lookup",
        target: "resources.synced_database_tables.existing",
      }),
    );
  });

  test("configured recovery does not mutate eligible entry or selected remote state", () => {
    const plan = {
      "resources.postgres_synced_tables.lookup": {
        action: "skip",
        remote_state: { id: "remote-id" },
        changes: {
          source_table_full_name: {
            action: "skip",
            reason: "spec:input_only",
            old: "cat.schema.source",
            new: "cat.schema.source",
          },
        },
      },
    } as const;
    const before = structuredClone(plan);

    const prepared = prepareEntries(plan);

    expect(
      prepared.byResourceKey.get("resources.postgres_synced_tables.lookup")?.sourceTableFullName,
    ).toEqual({ status: "supported", value: "cat.schema.source" });
    expect(plan).toEqual(before);
    expect(plan["resources.postgres_synced_tables.lookup"].remote_state).toEqual({
      id: "remote-id",
    });
  });

  test("new selected source values supersede configured history without mutating the plan", () => {
    const plan = {
      "resources.postgres_synced_tables.changed": {
        action: "update",
        remote_state: { id: "remote-id", source_table_full_name: "cat.schema.old" },
        new_state: { value: { source_table_full_name: "cat.schema.current" } },
        changes: {
          source_table_full_name: {
            action: "update",
            reason: "spec:input_only",
            old: "cat.schema.old",
            new: "cat.schema.current",
          },
        },
      },
    } as const;
    const before = structuredClone(plan);
    const prepared = prepareEntries(plan);
    expect(
      prepared.byResourceKey.get("resources.postgres_synced_tables.changed")?.sourceTableFullName,
    ).toEqual({
      status: "supported",
      value: "cat.schema.current",
    });
    expect(buildResourceGraphFromPlan({ plan }).lateralEdges).toContainEqual(
      expect.objectContaining({
        source: "resources.postgres_synced_tables.changed",
        target: "source-table::cat.schema.current",
      }),
    );
    expect(buildResourceGraphFromPlan({ plan }).lateralEdges).not.toContainEqual(
      expect.objectContaining({
        source: "resources.postgres_synced_tables.changed",
        target: "source-table::cat.schema.old",
      }),
    );
    expect(plan).toEqual(before);
  });
});

describe("preparePlan vector and monitor reference projections", () => {
  test("projects consumed fields, preserves optional absence, and diagnoses malformed shapes safely", () => {
    const prepared = prepareEntries({
      "resources.vector_search_indexes.direct": {
        action: "create",
        new_state: { value: { endpoint_name: "vector" } },
      },
      "resources.vector_search_indexes.sync": {
        action: "create",
        new_state: {
          value: {
            endpoint_name: "vector",
            delta_sync_index_spec: {
              source_table: "main.analytics.source",
              embedding_source_columns: [{ embedding_model_endpoint_name: "embed" }],
              unrelated: { opaque: true },
            },
          },
        },
      },
      "resources.vector_search_indexes.malformed": {
        action: "create",
        new_state: {
          value: {
            endpoint_name: "vector",
            delta_sync_index_spec: {
              source_table: "main.analytics.source",
              embedding_source_columns: [{ embedding_model_endpoint_name: 42 }],
            },
          },
        },
      },
      "resources.quality_monitors.monitor": {
        action: "create",
        new_state: { value: { table_name: "main.analytics.source", baseline_table_name: 7 } },
      },
      "resources.quality_monitors.valid_baseline": {
        action: "create",
        new_state: {
          value: {
            table_name: "main.analytics.monitored",
            baseline_table_name: "main.analytics.baseline",
          },
        },
      },
    });

    expect(
      prepared.byResourceKey.get("resources.vector_search_indexes.direct")?.vectorIndex,
    ).toEqual({
      status: "supported",
      value: { endpointName: "vector", sourceTable: "", embeddingEndpoints: [] },
    });
    expect(prepared.byResourceKey.get("resources.vector_search_indexes.sync")?.vectorIndex).toEqual(
      {
        status: "supported",
        value: {
          endpointName: "vector",
          sourceTable: "main.analytics.source",
          embeddingEndpoints: ["embed"],
        },
      },
    );
    expect(
      prepared.byResourceKey.get("resources.vector_search_indexes.malformed")?.vectorIndex,
    ).toMatchObject({
      status: "unsupported",
      diagnostic: { capability: "vector-index-references" },
    });
    expect(
      prepared.byResourceKey.get("resources.quality_monitors.monitor")?.qualityMonitorTableName,
    ).toEqual({ status: "supported", value: "main.analytics.source" });
    expect(
      prepared.byResourceKey.get("resources.quality_monitors.monitor")
        ?.qualityMonitorBaselineTableName,
    ).toMatchObject({
      status: "unsupported",
      diagnostic: { capability: "source-table-reference" },
    });
    expect(
      prepared.byResourceKey.get("resources.quality_monitors.valid_baseline")
        ?.qualityMonitorBaselineTableName,
    ).toEqual({ status: "supported", value: "main.analytics.baseline" });
    expect(JSON.stringify(prepared.diagnostics)).not.toContain("42");
  });

  test("uses the effective delete snapshot and does not mutate input", () => {
    const entries = {
      "resources.vector_search_indexes.deleted": {
        action: "delete",
        remote_state: {
          endpoint_name: "old-vector",
          delta_sync_index_spec: {
            source_table: "main.analytics.old",
          },
        },
        new_state: {
          value: {
            endpoint_name: "new-vector",
            delta_sync_index_spec: {
              source_table: "main.analytics.new",
            },
          },
        },
      },
    };
    const original = structuredClone(entries);
    const prepared = prepareEntries(entries);

    expect(
      prepared.byResourceKey.get("resources.vector_search_indexes.deleted")?.vectorIndex,
    ).toEqual({
      status: "supported",
      value: {
        endpointName: "old-vector",
        sourceTable: "main.analytics.old",
        embeddingEndpoints: [],
      },
    });
    expect(entries).toEqual(original);
  });
});

describe("preparePlan external location projection", () => {
  test("projects only a string credential name and safely diagnoses malformed values", () => {
    const prepared = prepareEntries({
      "resources.external_locations.valid": {
        action: "create",
        new_state: { value: { credential_name: "storage-prod" } },
      },
      "resources.external_locations.malformed": {
        action: "create",
        new_state: { value: { credential_name: { secret: "PRIVATE" } } },
      },
    });

    expect(
      prepared.byResourceKey.get("resources.external_locations.valid")
        ?.externalLocationCredentialName,
    ).toEqual({ status: "supported", value: "storage-prod" });
    expect(
      prepared.byResourceKey.get("resources.external_locations.malformed")
        ?.externalLocationCredentialName,
    ).toMatchObject({ status: "unsupported", diagnostic: { reason: "invalid-shape" } });
    expect(JSON.stringify(prepared.diagnostics)).not.toContain("PRIVATE");
  });
});

describe("preparePlan Postgres projections", () => {
  test("prepares consumed identities and diagnoses malformed fields safely", () => {
    const prepared = prepareEntries({
      "resources.postgres_branches.branch": {
        action: "create",
        new_state: {
          value: {
            branch_id: "br-1",
            parent: "projects/pr-1",
            source_branch: "projects/pr-1/branches/br-0",
            private: "SECRET",
          },
        },
      },
      "resources.postgres_databases.database": {
        action: "create",
        new_state: {
          value: { branch: "projects/pr-1/branches/br-1", postgres_database: "db-1", role: 42 },
        },
      },
    });

    expect(prepared.byResourceKey.get("resources.postgres_branches.branch")?.postgres).toEqual({
      status: "supported",
      value: {
        branch_id: "br-1",
        parent: "projects/pr-1",
        source_branch: "projects/pr-1/branches/br-0",
      },
    });
    expect(
      prepared.byResourceKey.get("resources.postgres_databases.database")?.postgres.status,
    ).toBe("unsupported");
    expect(prepared.diagnostics).toEqual([
      {
        resourceKey: "resources.postgres_databases.database",
        capability: "postgres-identity",
        reason: "invalid-shape",
      },
    ]);
    expect(JSON.stringify(prepared.diagnostics)).not.toContain("SECRET");
  });
});

test("snapshot schedule projects only its branch identity and leaves cadences opaque", () => {
  const entries = {
    "resources.postgres_snapshot_schedules.daily": {
      action: "create",
      new_state: {
        value: {
          branch: "projects/pr-1/branches/br-1",
          schedule: [
            { cadence: "DAILY", retention_days: 7 },
            { cadence: "MONTHLY", retention_days: 90 },
          ],
        },
      },
    },
  };
  const original = JSON.stringify(entries);
  const prepared = prepareEntries(entries);

  expect(
    prepared.byResourceKey.get("resources.postgres_snapshot_schedules.daily")?.postgres,
  ).toEqual({
    status: "supported",
    value: { branch: "projects/pr-1/branches/br-1" },
  });
  expect(prepared.diagnostics).toEqual([]);
  expect(JSON.stringify(entries)).toBe(original);
});

test("snapshot schedule does not infer identity when its branch projection is malformed or absent", () => {
  const prepared = prepareEntries({
    "resources.postgres_snapshot_schedules.malformed": {
      action: "update",
      new_state: { value: { branch: 42, schedule: "opaque malformed payload" } },
    },
    "resources.postgres_snapshot_schedules.absent": {
      action: "update",
      new_state: { value: { schedule: [{ cadence: "DAILY" }] } },
    },
  });

  expect(
    prepared.byResourceKey.get("resources.postgres_snapshot_schedules.malformed")?.postgres.status,
  ).toBe("unsupported");
  expect(
    prepared.byResourceKey.get("resources.postgres_snapshot_schedules.absent")?.postgres,
  ).toEqual({ status: "supported", value: {} });
  expect(prepared.diagnostics).toEqual([
    {
      resourceKey: "resources.postgres_snapshot_schedules.malformed",
      capability: "postgres-identity",
      reason: "invalid-shape",
    },
  ]);
});

describe("preparePlan instance-pool projections", () => {
  test("prepares pool references from pipeline clusters and diagnoses malformed shapes", () => {
    const prepared = prepareEntries({
      "resources.pipelines.valid": {
        action: "update",
        new_state: {
          value: { clusters: [{ instance_pool_id: "${" + "resources.instance_pools.small.id}" }] },
        },
      },
      "resources.pipelines.malformed": {
        action: "update",
        new_state: { value: { clusters: "not-an-array" } },
      },
      "resources.pipelines.empty": {
        action: "update",
        new_state: { value: {} },
        remote_state: {
          clusters: [{ instance_pool_id: "${" + "resources.instance_pools.historical.id}" }],
        },
      },
    });

    expect(prepared.byResourceKey.get("resources.pipelines.valid")?.instancePoolReferences).toEqual(
      {
        status: "supported",
        value: ["${" + "resources.instance_pools.small.id}"],
      },
    );
    expect(
      prepared.byResourceKey.get("resources.pipelines.malformed")?.instancePoolReferences.status,
    ).toBe("unsupported");
    expect(prepared.byResourceKey.get("resources.pipelines.empty")?.instancePoolReferences).toEqual(
      { status: "absent" },
    );
    expect(prepared.diagnostics).toContainEqual({
      resourceKey: "resources.pipelines.malformed",
      capability: "instance-pool-reference",
      reason: "invalid-shape",
    });
  });

  test("leaves source state unchanged while preparing cluster pools", () => {
    const input = {
      "resources.pipelines.pipeline": {
        action: "create",
        new_state: {
          value: { clusters: [{ instance_pool_id: "${" + "resources.instance_pools.small.id}" }] },
        },
      },
    };
    const before = structuredClone(input);

    prepareEntries(input);

    expect(input).toEqual(before);
  });
});

describe("preparePlan serving endpoint projections", () => {
  test("prepares warehouse string references and diagnoses malformed recognized values", () => {
    const prepared = prepareEntries({
      "resources.alerts.valid": {
        action: "create",
        new_state: { value: { warehouse_id: "warehouse-1" } },
      },
      "resources.alerts.malformed": {
        action: "create",
        new_state: { value: { warehouse_id: 42, private: "TOP_SECRET" } },
      },
      "resources.alerts.absent": {
        action: "create",
        new_state: { value: { title: "No warehouse" } },
      },
    });

    expect(prepared.byResourceKey.get("resources.alerts.valid")?.warehouseId).toEqual({
      status: "supported",
      value: "warehouse-1",
    });
    expect(prepared.byResourceKey.get("resources.alerts.malformed")?.warehouseId.status).toBe(
      "unsupported",
    );
    expect(prepared.byResourceKey.get("resources.alerts.absent")?.warehouseId).toEqual({
      status: "absent",
    });
    expect(prepared.diagnostics).toEqual([
      {
        resourceKey: "resources.alerts.malformed",
        capability: "warehouse-reference",
        reason: "invalid-shape",
      },
    ]);
    expect(JSON.stringify(prepared.diagnostics)).not.toContain("TOP_SECRET");
    const graph = buildResourceGraph(prepared);
    expect(graph.nodes.some((node) => node.id === "sql-warehouse::42")).toBe(false);
    expect(graph.lateralEdges.some((edge) => edge.source === "resources.alerts.malformed")).toBe(
      false,
    );
  });
  test("supports new and remote endpoint shapes, including an empty list", () => {
    const prepared = prepareEntries({
      "resources.model_serving_endpoints.new": {
        action: "create",
        new_state: {
          value: {
            config: {
              served_entities: [
                { entity_name: "catalog.schema.model", extra: { opaque: true } },
                { entity_version: "1" },
              ],
            },
          },
        },
      },
      "resources.model_serving_endpoints.remote": {
        action: "skip",
        remote_state: { endpoint_details: { config: { served_entities: [] } } },
      },
    });
    expect(
      prepared.byResourceKey.get("resources.model_serving_endpoints.new")?.servedEntityNames,
    ).toEqual({
      status: "supported",
      value: ["catalog.schema.model"],
    });
    expect(
      prepared.byResourceKey.get("resources.model_serving_endpoints.remote")?.servedEntityNames,
    ).toEqual({
      status: "supported",
      value: [],
    });
    expect(prepared.diagnostics).toEqual([]);
  });

  test("keeps malformed selected structures unsupported without exposing their values", () => {
    const prepared = prepareEntries({
      "resources.model_serving_endpoints.secret": {
        action: "update",
        new_state: {
          value: { config: { served_entities: [{ entity_name: 42, secret: "TOP_SECRET" }] } },
        },
      },
    });
    const resource = prepared.byResourceKey.get("resources.model_serving_endpoints.secret");
    expect(resource?.servedEntityNames.status).toBe("unsupported");
    expect(prepared.diagnostics).toEqual([
      {
        resourceKey: "resources.model_serving_endpoints.secret",
        capability: "serving-endpoint-models",
        reason: "invalid-shape",
      },
    ]);
    expect(JSON.stringify(prepared.diagnostics)).not.toContain("TOP_SECRET");
  });

  test("endpoint details without a config leave the model capability absent", () => {
    const prepared = prepareEntries({
      "resources.model_serving_endpoints.empty-details": {
        action: "create",
        new_state: { value: { endpoint_details: {} } },
      },
      "resources.model_serving_endpoints.opaque-details": {
        action: "create",
        new_state: { value: { endpoint_details: { name: "example", unrelated: true } } },
      },
    });

    expect(prepared.diagnostics).toEqual([]);
    for (const resourceKey of [
      "resources.model_serving_endpoints.empty-details",
      "resources.model_serving_endpoints.opaque-details",
    ]) {
      expect(prepared.byResourceKey.get(resourceKey)?.servedEntityNames).toEqual({
        status: "absent",
      });
    }
  });

  test("malformed present config data does not fall back to endpoint details", () => {
    const prepared = prepareEntries({
      "resources.model_serving_endpoints.precedence": {
        action: "update",
        new_state: {
          value: {
            config: { served_entities: "private-value" },
            endpoint_details: { config: { served_entities: [{ entity_name: "fallback" }] } },
          },
        },
      },
    });
    expect(
      prepared.byResourceKey.get("resources.model_serving_endpoints.precedence")?.servedEntityNames
        .status,
    ).toBe("unsupported");
  });

  test("malformed config containers do not fall back to endpoint details", () => {
    const prepared = prepareEntries({
      "resources.model_serving_endpoints.precedence": {
        action: "update",
        new_state: {
          value: {
            config: "TOP_SECRET",
            endpoint_details: { config: { served_entities: [{ entity_name: "fallback" }] } },
          },
        },
      },
    });
    const resource = prepared.byResourceKey.get("resources.model_serving_endpoints.precedence");

    expect(resource?.servedEntityNames.status).toBe("unsupported");
    expect(prepared.diagnostics).toEqual([
      {
        resourceKey: "resources.model_serving_endpoints.precedence",
        capability: "serving-endpoint-models",
        reason: "invalid-shape",
      },
    ]);
    expect(JSON.stringify(prepared.diagnostics)).not.toContain("TOP_SECRET");
    expect(buildResourceGraph(prepared).nodes).not.toContainEqual(
      expect.objectContaining({ id: "registered-model::fallback" }),
    );
  });

  test("valid config precedence ignores malformed unused endpoint details", () => {
    for (const endpointDetails of ["TOP_SECRET", { config: "TOP_SECRET" }]) {
      const prepared = prepareEntries({
        "resources.model_serving_endpoints.precedence": {
          action: "update",
          new_state: {
            value: {
              config: { served_entities: [{ entity_name: "catalog.schema.model" }] },
              endpoint_details: endpointDetails,
            },
          },
        },
      });
      const resource = prepared.byResourceKey.get("resources.model_serving_endpoints.precedence");
      const graph = buildResourceGraph(prepared);

      expect(resource?.servedEntityNames).toEqual({
        status: "supported",
        value: ["catalog.schema.model"],
      });
      expect(prepared.diagnostics).toEqual([]);
      expect(graph.nodes).toContainEqual(
        expect.objectContaining({ id: "registered-model::catalog.schema.model" }),
      );
      expect(graph.lateralEdges).toContainEqual(
        expect.objectContaining({ target: "registered-model::catalog.schema.model" }),
      );
    }
  });

  test("malformed serving containers are diagnosed without leaking values", () => {
    const prepared = prepareEntries({
      "resources.model_serving_endpoints.config": {
        action: "create",
        new_state: { value: { config: "private-config" } },
      },
      "resources.model_serving_endpoints.details": {
        action: "create",
        new_state: { value: { endpoint_details: "private-details" } },
      },
    });
    expect(prepared.diagnostics).toHaveLength(2);
    expect(
      prepared.diagnostics.every(
        (diagnostic) => diagnostic.capability === "serving-endpoint-models",
      ),
    ).toBe(true);
    expect(JSON.stringify(prepared.diagnostics)).not.toContain("private-");
  });

  test("opaque extra fields and entities without names remain accepted", () => {
    const prepared = prepareEntries({
      "resources.model_serving_endpoints.opaque": {
        action: "create",
        new_state: {
          value: { config: { served_entities: [{ external_model: { arbitrary: true } }] } },
        },
      },
      "resources.unknown_type.item": {
        action: "create",
        new_state: { value: { custom: "opaque" } },
      },
      "resources.model_serving_endpoints.absent": {
        action: "create",
        new_state: { value: { name: "no-serving-slice" } },
      },
    });
    expect(prepared.diagnostics).toEqual([]);
    expect(
      prepared.byResourceKey.get("resources.model_serving_endpoints.opaque")?.servedEntityNames,
    ).toEqual({ status: "supported", value: [] });
    expect(prepared.byResourceKey.get("resources.unknown_type.item")?.currentState.status).toBe(
      "supported",
    );
    expect(
      prepared.byResourceKey.get("resources.model_serving_endpoints.absent")?.servedEntityNames,
    ).toEqual({
      status: "absent",
    });
  });

  test("invalid current records are diagnosed while generic resources still render", () => {
    const prepared = prepareEntries({
      "resources.model_serving_endpoints.bad": {
        action: "update",
        new_state: { value: "opaque-secret" },
      },
      "resources.unknown_type.item": { action: "create", new_state: { value: { ok: true } } },
    });
    expect(prepared.diagnostics).toEqual([
      {
        resourceKey: "resources.model_serving_endpoints.bad",
        capability: "current-state",
        reason: "invalid-shape",
      },
    ]);
    const graph = buildResourceGraph(prepared);
    expect(
      graph.nodes.some((node) => node.resourceKey === "resources.model_serving_endpoints.bad"),
    ).toBe(true);
    expect(graph.nodes.some((node) => node.resourceKey === "resources.unknown_type.item")).toBe(
      true,
    );
    expect(JSON.stringify(prepared.diagnostics)).not.toContain("opaque-secret");
  });

  test("prepared names drive phantom nodes and lateral edges together", () => {
    const prepared = prepareEntries({
      "resources.model_serving_endpoints.endpoint": {
        action: "create",
        new_state: {
          value: { config: { served_entities: [{ entity_name: "catalog.schema.model" }] } },
        },
      },
    });
    const graph = buildResourceGraph(prepared);
    expect(graph.nodes.some((node) => node.id === "registered-model::catalog.schema.model")).toBe(
      true,
    );
    expect(
      graph.lateralEdges.some((edge) => edge.target === "registered-model::catalog.schema.model"),
    ).toBe(true);
  });
});
