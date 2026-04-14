import { describe, expect, test } from "bun:test";
import {
  collectPhantomAppDependencies,
  collectPhantomDatabaseInstances,
  collectPhantomExternalRefs,
} from "../../src/graph/collect-phantom-nodes.ts";
import { buildApiIdIndex } from "../../src/graph/extract-lateral-edges.ts";
import { extractStateField } from "../../src/graph/extract-resource-state.ts";
import { buildJobIdMap } from "../../src/graph/resolve-run-job-target.ts";
import type { PlanEntry } from "../../src/types/plan-schema.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PARENT_ID = "workspace-root";

const makeEntry = (state: Record<string, unknown>, action = "create"): PlanEntry =>
  ({
    action,
    new_state: { value: state },
  }) as PlanEntry;

const makeSkipEntry = (remoteState: Record<string, unknown>): PlanEntry =>
  ({
    action: "skip",
    new_state: {},
    remote_state: remoteState,
  }) as PlanEntry;

/** Build warehouse + dashboard + pipeline + jobIdMap indexes from entries. */
const buildIndexes = (entries: readonly (readonly [string, PlanEntry])[]) => ({
  warehouseIndex: buildApiIdIndex(entries, "sql_warehouses", (e) => extractStateField(e, "id")),
  dashboardIndex: buildApiIdIndex(entries, "dashboards", (e) =>
    extractStateField(e, "dashboard_id"),
  ),
  pipelineIndex: buildApiIdIndex(entries, "pipelines", (e) => extractStateField(e, "pipeline_id")),
  jobIdMap: buildJobIdMap(entries),
});

// ---------------------------------------------------------------------------
// collectPhantomExternalRefs
// ---------------------------------------------------------------------------

describe("collectPhantomExternalRefs", () => {
  test("alert with warehouse_id referencing non-existent warehouse creates phantom", () => {
    const entries: [string, PlanEntry][] = [
      ["resources.alerts.stale", makeEntry({ warehouse_id: "wh1" })],
    ];
    const { warehouseIndex, dashboardIndex, pipelineIndex, jobIdMap } = buildIndexes(entries);

    const result = collectPhantomExternalRefs(entries, PARENT_ID, {
      warehouseIndex,
      dashboardIndex,
      pipelineIndex,
      jobIdMap,
    });

    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]).toMatchObject({
      id: "sql-warehouse::wh1",
      label: "wh1",
      nodeKind: "phantom",
      diffState: "unchanged",
    });
    expect(result.edges).toHaveLength(1);
  });

  test("dashboard with warehouse_id referencing non-existent warehouse creates phantom", () => {
    const entries: [string, PlanEntry][] = [
      ["resources.dashboards.sales", makeEntry({ warehouse_id: "wh2" })],
    ];
    const { warehouseIndex, dashboardIndex, pipelineIndex, jobIdMap } = buildIndexes(entries);

    const result = collectPhantomExternalRefs(entries, PARENT_ID, {
      warehouseIndex,
      dashboardIndex,
      pipelineIndex,
      jobIdMap,
    });

    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]?.id).toBe("sql-warehouse::wh2");
  });

  test("quality_monitor with warehouse_id referencing non-existent warehouse creates phantom", () => {
    const entries: [string, PlanEntry][] = [
      ["resources.quality_monitors.drift", makeEntry({ warehouse_id: "wh3" })],
    ];
    const { warehouseIndex, dashboardIndex, pipelineIndex, jobIdMap } = buildIndexes(entries);

    const result = collectPhantomExternalRefs(entries, PARENT_ID, {
      warehouseIndex,
      dashboardIndex,
      pipelineIndex,
      jobIdMap,
    });

    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]?.id).toBe("sql-warehouse::wh3");
  });

  test("alert with warehouse_id referencing existing warehouse creates no phantom", () => {
    const entries: [string, PlanEntry][] = [
      ["resources.alerts.stale", makeEntry({ warehouse_id: "wh1" })],
      ["resources.sql_warehouses.main", makeEntry({ id: "wh1", name: "main" })],
    ];
    const { warehouseIndex, dashboardIndex, pipelineIndex, jobIdMap } = buildIndexes(entries);

    const result = collectPhantomExternalRefs(entries, PARENT_ID, {
      warehouseIndex,
      dashboardIndex,
      pipelineIndex,
      jobIdMap,
    });

    expect(result.nodes).toHaveLength(0);
    expect(result.edges).toHaveLength(0);
  });

  test("job with sql_task.warehouse_id referencing non-existent warehouse creates phantom", () => {
    const entries: [string, PlanEntry][] = [
      [
        "resources.jobs.etl",
        makeEntry({ tasks: [{ task_key: "t1", sql_task: { warehouse_id: "wh1" } }] }),
      ],
    ];
    const { warehouseIndex, dashboardIndex, pipelineIndex, jobIdMap } = buildIndexes(entries);

    const result = collectPhantomExternalRefs(entries, PARENT_ID, {
      warehouseIndex,
      dashboardIndex,
      pipelineIndex,
      jobIdMap,
    });

    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]?.id).toBe("sql-warehouse::wh1");
  });

  test("job with dashboard_task.dashboard_id referencing non-existent dashboard creates phantom", () => {
    const entries: [string, PlanEntry][] = [
      [
        "resources.jobs.report",
        makeEntry({
          tasks: [{ task_key: "t1", dashboard_task: { dashboard_id: "d1" } }],
        }),
      ],
    ];
    const { warehouseIndex, dashboardIndex, pipelineIndex, jobIdMap } = buildIndexes(entries);

    const result = collectPhantomExternalRefs(entries, PARENT_ID, {
      warehouseIndex,
      dashboardIndex,
      pipelineIndex,
      jobIdMap,
    });

    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]).toMatchObject({
      id: "dashboard::d1",
      label: "d1",
      nodeKind: "phantom",
    });
  });

  test("job with dashboard_task referencing existing dashboard creates no phantom", () => {
    const entries: [string, PlanEntry][] = [
      [
        "resources.jobs.report",
        makeEntry({
          tasks: [{ task_key: "t1", dashboard_task: { dashboard_id: "d1" } }],
        }),
      ],
      ["resources.dashboards.sales", makeEntry({ dashboard_id: "d1", display_name: "Sales" })],
    ];
    const { warehouseIndex, dashboardIndex, pipelineIndex, jobIdMap } = buildIndexes(entries);

    const result = collectPhantomExternalRefs(entries, PARENT_ID, {
      warehouseIndex,
      dashboardIndex,
      pipelineIndex,
      jobIdMap,
    });

    expect(result.nodes).toHaveLength(0);
  });

  test("multiple references to same warehouse from different sources produce single phantom", () => {
    const entries: [string, PlanEntry][] = [
      ["resources.alerts.a1", makeEntry({ warehouse_id: "wh1" })],
      ["resources.dashboards.d1", makeEntry({ warehouse_id: "wh1" })],
      [
        "resources.jobs.j1",
        makeEntry({ tasks: [{ task_key: "t1", sql_task: { warehouse_id: "wh1" } }] }),
      ],
    ];
    const { warehouseIndex, dashboardIndex, pipelineIndex, jobIdMap } = buildIndexes(entries);

    const result = collectPhantomExternalRefs(entries, PARENT_ID, {
      warehouseIndex,
      dashboardIndex,
      pipelineIndex,
      jobIdMap,
    });

    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]?.id).toBe("sql-warehouse::wh1");
  });

  test("job with multiple tasks — only tasks with warehouse_id create phantoms", () => {
    const entries: [string, PlanEntry][] = [
      [
        "resources.jobs.mixed",
        makeEntry({
          tasks: [
            { task_key: "t1", notebook_task: { notebook_path: "/foo" } },
            { task_key: "t2", sql_task: { warehouse_id: "wh1" } },
          ],
        }),
      ],
    ];
    const { warehouseIndex, dashboardIndex, pipelineIndex, jobIdMap } = buildIndexes(entries);

    const result = collectPhantomExternalRefs(entries, PARENT_ID, {
      warehouseIndex,
      dashboardIndex,
      pipelineIndex,
      jobIdMap,
    });

    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]?.id).toBe("sql-warehouse::wh1");
  });

  test("job with no tasks creates no phantoms", () => {
    const entries: [string, PlanEntry][] = [["resources.jobs.empty", makeEntry({ name: "empty" })]];
    const { warehouseIndex, dashboardIndex, pipelineIndex, jobIdMap } = buildIndexes(entries);

    const result = collectPhantomExternalRefs(entries, PARENT_ID, {
      warehouseIndex,
      dashboardIndex,
      pipelineIndex,
      jobIdMap,
    });

    expect(result.nodes).toHaveLength(0);
    expect(result.edges).toHaveLength(0);
  });

  test("empty entries create no phantoms", () => {
    const entries: [string, PlanEntry][] = [];
    const { warehouseIndex, dashboardIndex, pipelineIndex, jobIdMap } = buildIndexes(entries);

    const result = collectPhantomExternalRefs(entries, PARENT_ID, {
      warehouseIndex,
      dashboardIndex,
      pipelineIndex,
      jobIdMap,
    });

    expect(result.nodes).toHaveLength(0);
    expect(result.edges).toHaveLength(0);
  });

  test("phantom node has correct resourceKey matching its ID", () => {
    const entries: [string, PlanEntry][] = [
      ["resources.alerts.a1", makeEntry({ warehouse_id: "wh1" })],
      [
        "resources.jobs.j1",
        makeEntry({
          tasks: [{ task_key: "t1", dashboard_task: { dashboard_id: "d1" } }],
        }),
      ],
    ];
    const { warehouseIndex, dashboardIndex, pipelineIndex, jobIdMap } = buildIndexes(entries);

    const result = collectPhantomExternalRefs(entries, PARENT_ID, {
      warehouseIndex,
      dashboardIndex,
      pipelineIndex,
      jobIdMap,
    });

    expect(result.nodes).toHaveLength(2);
    for (const node of result.nodes) {
      expect(node.resourceKey).toBe(node.id);
    }
  });

  test("phantom nodes are parented to workspace root", () => {
    const entries: [string, PlanEntry][] = [
      ["resources.alerts.a1", makeEntry({ warehouse_id: "wh1" })],
    ];
    const { warehouseIndex, dashboardIndex, pipelineIndex, jobIdMap } = buildIndexes(entries);

    const result = collectPhantomExternalRefs(entries, PARENT_ID, {
      warehouseIndex,
      dashboardIndex,
      pipelineIndex,
      jobIdMap,
    });

    expect(result.edges).toHaveLength(1);
    expect(result.edges[0]?.source).toBe(PARENT_ID);
    expect(result.edges[0]?.target).toBe("sql-warehouse::wh1");
  });

  test("skip entries use remote_state for task extraction", () => {
    const entries: [string, PlanEntry][] = [
      [
        "resources.jobs.etl",
        makeSkipEntry({ tasks: [{ task_key: "t1", sql_task: { warehouse_id: "wh1" } }] }),
      ],
    ];
    const { warehouseIndex, dashboardIndex, pipelineIndex, jobIdMap } = buildIndexes(entries);

    const result = collectPhantomExternalRefs(entries, PARENT_ID, {
      warehouseIndex,
      dashboardIndex,
      pipelineIndex,
      jobIdMap,
    });

    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]?.id).toBe("sql-warehouse::wh1");
  });

  test("dashboard_task with both warehouse_id and dashboard_id creates two phantoms", () => {
    const entries: [string, PlanEntry][] = [
      [
        "resources.jobs.report",
        makeEntry({
          tasks: [{ task_key: "t1", dashboard_task: { warehouse_id: "wh1", dashboard_id: "d1" } }],
        }),
      ],
    ];
    const { warehouseIndex, dashboardIndex, pipelineIndex, jobIdMap } = buildIndexes(entries);

    const result = collectPhantomExternalRefs(entries, PARENT_ID, {
      warehouseIndex,
      dashboardIndex,
      pipelineIndex,
      jobIdMap,
    });

    expect(result.nodes).toHaveLength(2);
    const ids = result.nodes.map((n) => n.id).sort();
    expect(ids).toEqual(["dashboard::d1", "sql-warehouse::wh1"]);
  });
});

// ---------------------------------------------------------------------------
// run_job_task → job phantom
// ---------------------------------------------------------------------------

describe("collectPhantomExternalRefs: run_job_task", () => {
  test("external numeric job_id not in jobIdMap creates job phantom", () => {
    const sourceEntry: PlanEntry = {
      action: "create",
      new_state: {
        value: {
          name: "source",
          tasks: [{ task_key: "trigger", run_job_task: { job_id: 99999 } }],
        },
      },
    } as PlanEntry;
    const entries: [string, PlanEntry][] = [["resources.jobs.source", sourceEntry]];
    const { warehouseIndex, dashboardIndex, pipelineIndex, jobIdMap } = buildIndexes(entries);

    const result = collectPhantomExternalRefs(entries, PARENT_ID, {
      warehouseIndex,
      dashboardIndex,
      pipelineIndex,
      jobIdMap,
    });

    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]).toMatchObject({
      id: "job::99999",
      label: "99999",
      nodeKind: "phantom",
    });
  });

  test("in-bundle job_id present in jobIdMap creates no phantom", () => {
    const sourceEntry: PlanEntry = {
      action: "update",
      new_state: {
        value: {
          name: "source",
          tasks: [{ task_key: "trigger", run_job_task: { job_id: 55555 } }],
        },
      },
      remote_state: { job_id: 111 },
    } as PlanEntry;
    const downstreamEntry: PlanEntry = {
      action: "update",
      new_state: { value: { name: "downstream" } },
      remote_state: { job_id: 55555 },
    } as PlanEntry;
    const entries: [string, PlanEntry][] = [
      ["resources.jobs.source", sourceEntry],
      ["resources.jobs.downstream", downstreamEntry],
    ];
    const { warehouseIndex, dashboardIndex, pipelineIndex, jobIdMap } = buildIndexes(entries);

    const result = collectPhantomExternalRefs(entries, PARENT_ID, {
      warehouseIndex,
      dashboardIndex,
      pipelineIndex,
      jobIdMap,
    });

    expect(result.nodes).toHaveLength(0);
  });

  test("placeholder job_id 0 creates no phantom (resolves via vars interpolation)", () => {
    const sourceEntry: PlanEntry = {
      action: "create",
      new_state: {
        vars: {
          // biome-ignore lint/suspicious/noTemplateCurlyInString: Databricks vars interpolation syntax
          "tasks[0].run_job_task.job_id": "${resources.jobs.downstream.id}",
        },
        value: {
          name: "source",
          tasks: [{ task_key: "trigger", run_job_task: { job_id: 0 } }],
        },
      },
    } as PlanEntry;
    const entries: [string, PlanEntry][] = [["resources.jobs.source", sourceEntry]];
    const { warehouseIndex, dashboardIndex, pipelineIndex, jobIdMap } = buildIndexes(entries);

    const result = collectPhantomExternalRefs(entries, PARENT_ID, {
      warehouseIndex,
      dashboardIndex,
      pipelineIndex,
      jobIdMap,
    });

    expect(result.nodes).toHaveLength(0);
  });

  test("string interpolation job_id creates no phantom (resolves in-bundle)", () => {
    const sourceEntry: PlanEntry = {
      action: "create",
      new_state: {
        value: {
          name: "source",
          tasks: [
            {
              task_key: "trigger",
              // biome-ignore lint/suspicious/noTemplateCurlyInString: Databricks vars interpolation syntax
              run_job_task: { job_id: "${resources.jobs.downstream.id}" },
            },
          ],
        },
      },
    } as PlanEntry;
    const entries: [string, PlanEntry][] = [["resources.jobs.source", sourceEntry]];
    const { warehouseIndex, dashboardIndex, pipelineIndex, jobIdMap } = buildIndexes(entries);

    const result = collectPhantomExternalRefs(entries, PARENT_ID, {
      warehouseIndex,
      dashboardIndex,
      pipelineIndex,
      jobIdMap,
    });

    expect(result.nodes).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// collectPhantomDatabaseInstances
// ---------------------------------------------------------------------------

describe("collectPhantomDatabaseInstances", () => {
  test("synced_database_tables referencing absent instance creates phantom", () => {
    const entries: [string, PlanEntry][] = [
      ["resources.synced_database_tables.t1", makeEntry({ database_instance_name: "my_pg" })],
    ];
    const existingKeys = new Set<string>();

    const result = collectPhantomDatabaseInstances(entries, existingKeys, PARENT_ID);

    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]).toMatchObject({
      id: "database-instance::my_pg",
      label: "my_pg",
      nodeKind: "phantom",
      diffState: "unchanged",
    });
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0]?.source).toBe(PARENT_ID);
    expect(result.edges[0]?.target).toBe("database-instance::my_pg");
  });

  test("database_catalogs referencing absent instance creates phantom", () => {
    const entries: [string, PlanEntry][] = [
      ["resources.database_catalogs.c1", makeEntry({ database_instance_name: "my_mysql" })],
    ];

    const result = collectPhantomDatabaseInstances(entries, new Set(), PARENT_ID);

    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]?.id).toBe("database-instance::my_mysql");
  });

  test("existing database instance creates no phantom", () => {
    const entries: [string, PlanEntry][] = [
      ["resources.synced_database_tables.t1", makeEntry({ database_instance_name: "my_pg" })],
    ];
    const existingKeys = new Set(["resources.database_instances.my_pg"]);

    const result = collectPhantomDatabaseInstances(entries, existingKeys, PARENT_ID);

    expect(result.nodes).toHaveLength(0);
    expect(result.edges).toHaveLength(0);
  });

  test("multiple references to same instance produce single phantom", () => {
    const entries: [string, PlanEntry][] = [
      ["resources.synced_database_tables.t1", makeEntry({ database_instance_name: "my_pg" })],
      ["resources.synced_database_tables.t2", makeEntry({ database_instance_name: "my_pg" })],
      ["resources.database_catalogs.c1", makeEntry({ database_instance_name: "my_pg" })],
    ];

    const result = collectPhantomDatabaseInstances(entries, new Set(), PARENT_ID);

    expect(result.nodes).toHaveLength(1);
  });

  test("phantom resourceKey uses dot-path form", () => {
    const entries: [string, PlanEntry][] = [
      ["resources.synced_database_tables.t1", makeEntry({ database_instance_name: "my_pg" })],
    ];

    const result = collectPhantomDatabaseInstances(entries, new Set(), PARENT_ID);

    expect(result.nodes[0]?.resourceKey).toBe("resources.database_instances.my_pg");
    expect(result.nodes[0]?.id).toBe("database-instance::my_pg");
  });

  test("entry without database_instance_name creates no phantom", () => {
    const entries: [string, PlanEntry][] = [
      ["resources.synced_database_tables.t1", makeEntry({ name: "foo" })],
    ];

    const result = collectPhantomDatabaseInstances(entries, new Set(), PARENT_ID);

    expect(result.nodes).toHaveLength(0);
  });

  test("non-database resource types are ignored", () => {
    const entries: [string, PlanEntry][] = [
      ["resources.jobs.j1", makeEntry({ database_instance_name: "my_pg" })],
    ];

    const result = collectPhantomDatabaseInstances(entries, new Set(), PARENT_ID);

    expect(result.nodes).toHaveLength(0);
  });

  test("empty entries create no phantoms", () => {
    const result = collectPhantomDatabaseInstances([], new Set(), PARENT_ID);

    expect(result.nodes).toHaveLength(0);
    expect(result.edges).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// collectPhantomAppDependencies
// ---------------------------------------------------------------------------

describe("collectPhantomAppDependencies", () => {
  const makeAppEntry = (resources: readonly Record<string, unknown>[]): PlanEntry =>
    ({ action: "create", new_state: { value: { resources } } }) as PlanEntry;

  test("app referencing absent job creates phantom", () => {
    const entries: [string, PlanEntry][] = [
      [
        "resources.apps.myapp",
        makeAppEntry([{ job: { id: "123", permission_level: "IS_OWNER" } }]),
      ],
    ];

    const result = collectPhantomAppDependencies(entries, new Set(), PARENT_ID, new Map());

    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]).toMatchObject({
      id: "job::123",
      label: "123",
      nodeKind: "phantom",
      diffState: "unchanged",
    });
    expect(result.edges).toHaveLength(1);
  });

  test("app referencing existing job creates no phantom", () => {
    const entries: [string, PlanEntry][] = [
      [
        "resources.apps.myapp",
        makeAppEntry([{ job: { id: "123", permission_level: "IS_OWNER" } }]),
      ],
      ["resources.jobs.etl", makeEntry({ job_id: 123 })],
    ];

    const result = collectPhantomAppDependencies(entries, new Set(), PARENT_ID, new Map());

    expect(result.nodes).toHaveLength(0);
  });

  test("app referencing absent sql_warehouse creates phantom", () => {
    const entries: [string, PlanEntry][] = [
      ["resources.apps.myapp", makeAppEntry([{ sql_warehouse: { id: "wh1" } }])],
    ];

    const result = collectPhantomAppDependencies(entries, new Set(), PARENT_ID, new Map());

    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]?.id).toBe("sql-warehouse::wh1");
  });

  test("app referencing existing sql_warehouse creates no phantom", () => {
    const entries: [string, PlanEntry][] = [
      ["resources.apps.myapp", makeAppEntry([{ sql_warehouse: { id: "wh1" } }])],
    ];
    const warehouseIndex = new Map([["wh1", "resources.sql_warehouses.main"]]);

    const result = collectPhantomAppDependencies(entries, new Set(), PARENT_ID, warehouseIndex);

    expect(result.nodes).toHaveLength(0);
  });

  test("app referencing absent secret_scope creates phantom", () => {
    const entries: [string, PlanEntry][] = [
      ["resources.apps.myapp", makeAppEntry([{ secret: { scope: "my_scope", key: "token" } }])],
    ];

    const result = collectPhantomAppDependencies(entries, new Set(), PARENT_ID, new Map());

    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]?.id).toBe("secret-scope::my_scope");
    expect(result.nodes[0]?.resourceKey).toBe("resources.secret_scopes.my_scope");
  });

  test("app referencing existing secret_scope creates no phantom", () => {
    const entries: [string, PlanEntry][] = [
      ["resources.apps.myapp", makeAppEntry([{ secret: { scope: "my_scope", key: "token" } }])],
    ];
    const existingKeys = new Set(["resources.secret_scopes.my_scope"]);

    const result = collectPhantomAppDependencies(entries, existingKeys, PARENT_ID, new Map());

    expect(result.nodes).toHaveLength(0);
  });

  test("app referencing absent serving_endpoint creates phantom", () => {
    const entries: [string, PlanEntry][] = [
      [
        "resources.apps.myapp",
        makeAppEntry([{ serving_endpoint: { name: "llm_ep", permission: "CAN_QUERY" } }]),
      ],
    ];

    const result = collectPhantomAppDependencies(entries, new Set(), PARENT_ID, new Map());

    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]?.id).toBe("serving-endpoint::llm_ep");
    expect(result.nodes[0]?.resourceKey).toBe("resources.model_serving_endpoints.llm_ep");
  });

  test("app with multiple absent references creates deduped phantoms", () => {
    const entries: [string, PlanEntry][] = [
      [
        "resources.apps.myapp",
        makeAppEntry([
          { job: { id: "123", permission_level: "IS_OWNER" } },
          { sql_warehouse: { id: "wh1" } },
          { secret: { scope: "s1", key: "k" } },
        ]),
      ],
    ];

    const result = collectPhantomAppDependencies(entries, new Set(), PARENT_ID, new Map());

    expect(result.nodes).toHaveLength(3);
    const ids = result.nodes.map((n) => n.id).sort();
    expect(ids).toEqual(["job::123", "secret-scope::s1", "sql-warehouse::wh1"]);
  });

  test("non-app entries are ignored", () => {
    const entries: [string, PlanEntry][] = [
      ["resources.jobs.j1", makeEntry({ resources: [{ job: { id: "123" } }] })],
    ];

    const result = collectPhantomAppDependencies(entries, new Set(), PARENT_ID, new Map());

    expect(result.nodes).toHaveLength(0);
  });

  test("empty entries create no phantoms", () => {
    const result = collectPhantomAppDependencies([], new Set(), PARENT_ID, new Map());

    expect(result.nodes).toHaveLength(0);
    expect(result.edges).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// collectPhantomExternalRefs — pipeline_task phantoms
// ---------------------------------------------------------------------------

describe("collectPhantomExternalRefs — pipeline_task", () => {
  test("job with pipeline_task referencing non-existent pipeline creates phantom", () => {
    const entries: [string, PlanEntry][] = [
      [
        "resources.jobs.runner",
        makeEntry({
          tasks: [{ task_key: "t1", pipeline_task: { pipeline_id: "p1" } }],
        }),
      ],
    ];
    const { warehouseIndex, dashboardIndex, pipelineIndex, jobIdMap } = buildIndexes(entries);

    const result = collectPhantomExternalRefs(entries, PARENT_ID, {
      warehouseIndex,
      dashboardIndex,
      pipelineIndex,
      jobIdMap,
    });

    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]).toMatchObject({
      id: "pipeline::p1",
      label: "p1",
      nodeKind: "phantom",
    });
    expect(result.edges).toHaveLength(1);
  });

  test("job with pipeline_task referencing existing pipeline creates no phantom", () => {
    const entries: [string, PlanEntry][] = [
      [
        "resources.jobs.runner",
        makeEntry({
          tasks: [{ task_key: "t1", pipeline_task: { pipeline_id: "p1" } }],
        }),
      ],
      ["resources.pipelines.etl", makeEntry({ pipeline_id: "p1" })],
    ];
    const { warehouseIndex, dashboardIndex, pipelineIndex, jobIdMap } = buildIndexes(entries);

    const result = collectPhantomExternalRefs(entries, PARENT_ID, {
      warehouseIndex,
      dashboardIndex,
      pipelineIndex,
      jobIdMap,
    });

    const pipelinePhantoms = result.nodes.filter((n) => n.id.startsWith("pipeline::"));
    expect(pipelinePhantoms).toHaveLength(0);
  });

  test("pipeline_task with both warehouse and pipeline creates two phantoms", () => {
    const entries: [string, PlanEntry][] = [
      [
        "resources.jobs.runner",
        makeEntry({
          tasks: [
            { task_key: "t1", pipeline_task: { pipeline_id: "p1" } },
            { task_key: "t2", sql_task: { warehouse_id: "wh1" } },
          ],
        }),
      ],
    ];
    const { warehouseIndex, dashboardIndex, pipelineIndex, jobIdMap } = buildIndexes(entries);

    const result = collectPhantomExternalRefs(entries, PARENT_ID, {
      warehouseIndex,
      dashboardIndex,
      pipelineIndex,
      jobIdMap,
    });

    expect(result.nodes).toHaveLength(2);
    const ids = result.nodes.map((n) => n.id).sort();
    expect(ids).toEqual(["pipeline::p1", "sql-warehouse::wh1"]);
  });
});
