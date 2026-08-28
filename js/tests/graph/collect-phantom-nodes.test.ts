import { describe, expect, test } from "bun:test";
import {
  collectPhantomAppDependencies,
  collectPhantomDatabaseInstances,
  collectPhantomExistingPipelines,
  collectPhantomExternalRefs,
} from "../../src/graph/collect-phantom-nodes.ts";
import { buildDerivedReferenceIndex } from "../../src/graph/derived-node-specs.ts";
import { extractStateField } from "../../src/graph/extract-resource-state.ts";
import {
  buildApiIdIndex,
  extractGenieSpaceApiId,
  extractJobApiId,
  type ReferenceIndexes,
} from "../../src/graph/reference-specs.ts";
import { buildJobIdMap } from "../../src/graph/resolve-run-job-target.ts";
import type { PlanEntry } from "../../src/types/plan-schema.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

/** Build shared reference indexes from entries. */
const buildIndexes = (entries: readonly (readonly [string, PlanEntry])[]): ReferenceIndexes => ({
  warehouseIndex: buildApiIdIndex(entries, "sql_warehouses", (e) => extractStateField(e, "id")),
  dashboardIndex: buildApiIdIndex(entries, "dashboards", (e) =>
    extractStateField(e, "dashboard_id"),
  ),
  pipelineIndex: new Map([
    ...buildDerivedReferenceIndex(entries, "pipelines"),
    ...buildApiIdIndex(entries, "pipelines", (e) => extractStateField(e, "pipeline_id")),
  ]),
  genieSpaceIndex: buildApiIdIndex(entries, "genie_spaces", extractGenieSpaceApiId),
  jobIndex: buildApiIdIndex(entries, "jobs", extractJobApiId),
  experimentIndex: buildApiIdIndex(entries, "experiments", (e) =>
    extractStateField(e, "experiment_id"),
  ),
  registeredModelFullNameIndex: buildApiIdIndex(entries, "registered_models", (e) =>
    extractStateField(e, "full_name"),
  ),
  jobIdMap: buildJobIdMap(entries),
});

const collectExternalRefs = (entries: readonly (readonly [string, PlanEntry])[]) =>
  collectPhantomExternalRefs(entries, buildIndexes(entries));

const collectAppDependencies = (
  entries: readonly (readonly [string, PlanEntry])[],
  existingKeys: ReadonlySet<string> = new Set(),
  indexes: ReferenceIndexes = buildIndexes(entries),
) => collectPhantomAppDependencies(entries, existingKeys, indexes);

// ---------------------------------------------------------------------------
// collectPhantomExternalRefs
// ---------------------------------------------------------------------------

describe("collectPhantomExternalRefs", () => {
  test("alert with warehouse_id referencing non-existent warehouse creates phantom", () => {
    const entries: [string, PlanEntry][] = [
      ["resources.alerts.stale", makeEntry({ warehouse_id: "wh1" })],
    ];
    const nodes = collectExternalRefs(entries);

    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({
      id: "sql-warehouse::wh1",
      label: "wh1",
      nodeKind: "phantom",
      diffState: "unchanged",
    });
  });

  test("dashboard with warehouse_id referencing non-existent warehouse creates phantom", () => {
    const entries: [string, PlanEntry][] = [
      ["resources.dashboards.sales", makeEntry({ warehouse_id: "wh2" })],
    ];
    const nodes = collectExternalRefs(entries);

    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.id).toBe("sql-warehouse::wh2");
  });

  test("quality_monitor with warehouse_id referencing non-existent warehouse creates phantom", () => {
    const entries: [string, PlanEntry][] = [
      ["resources.quality_monitors.drift", makeEntry({ warehouse_id: "wh3" })],
    ];
    const nodes = collectExternalRefs(entries);

    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.id).toBe("sql-warehouse::wh3");
  });

  test("genie_space with warehouse_id referencing non-existent warehouse creates phantom", () => {
    const entries: [string, PlanEntry][] = [
      ["resources.genie_spaces.taxi", makeEntry({ title: "Taxi Genie", warehouse_id: "wh4" })],
    ];
    const nodes = collectExternalRefs(entries);

    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.id).toBe("sql-warehouse::wh4");
  });

  test("alert with warehouse_id referencing existing warehouse creates no phantom", () => {
    const entries: [string, PlanEntry][] = [
      ["resources.alerts.stale", makeEntry({ warehouse_id: "wh1" })],
      ["resources.sql_warehouses.main", makeEntry({ id: "wh1", name: "main" })],
    ];
    const nodes = collectExternalRefs(entries);

    expect(nodes).toHaveLength(0);
  });

  test("job with sql_task.warehouse_id referencing non-existent warehouse creates phantom", () => {
    const entries: [string, PlanEntry][] = [
      [
        "resources.jobs.etl",
        makeEntry({ tasks: [{ task_key: "t1", sql_task: { warehouse_id: "wh1" } }] }),
      ],
    ];
    const nodes = collectExternalRefs(entries);

    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.id).toBe("sql-warehouse::wh1");
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
    const nodes = collectExternalRefs(entries);

    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({
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
    const nodes = collectExternalRefs(entries);

    expect(nodes).toHaveLength(0);
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
    const nodes = collectExternalRefs(entries);

    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.id).toBe("sql-warehouse::wh1");
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
    const nodes = collectExternalRefs(entries);

    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.id).toBe("sql-warehouse::wh1");
  });

  test("job with no tasks creates no phantoms", () => {
    const entries: [string, PlanEntry][] = [["resources.jobs.empty", makeEntry({ name: "empty" })]];
    const nodes = collectExternalRefs(entries);

    expect(nodes).toHaveLength(0);
  });

  test("empty entries create no phantoms", () => {
    const entries: [string, PlanEntry][] = [];
    const nodes = collectExternalRefs(entries);

    expect(nodes).toHaveLength(0);
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
    const nodes = collectExternalRefs(entries);

    expect(nodes).toHaveLength(2);
    for (const node of nodes) {
      expect(node.resourceKey).toBe(node.id);
    }
  });

  test("skip entries use remote_state for task extraction", () => {
    const entries: [string, PlanEntry][] = [
      [
        "resources.jobs.etl",
        makeSkipEntry({ tasks: [{ task_key: "t1", sql_task: { warehouse_id: "wh1" } }] }),
      ],
    ];
    const nodes = collectExternalRefs(entries);

    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.id).toBe("sql-warehouse::wh1");
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
    const nodes = collectExternalRefs(entries);

    expect(nodes).toHaveLength(2);
    const ids = nodes.map((n) => n.id).sort();
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
    const nodes = collectExternalRefs(entries);

    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({
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
    const nodes = collectExternalRefs(entries);

    expect(nodes).toHaveLength(0);
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
    const nodes = collectExternalRefs(entries);

    expect(nodes).toHaveLength(0);
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
    const nodes = collectExternalRefs(entries);

    expect(nodes).toHaveLength(0);
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

    const nodes = collectPhantomDatabaseInstances(entries, existingKeys);

    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({
      id: "database-instance::my_pg",
      label: "my_pg",
      nodeKind: "phantom",
      diffState: "unchanged",
    });
  });

  test("database_catalogs referencing absent instance creates phantom", () => {
    const entries: [string, PlanEntry][] = [
      ["resources.database_catalogs.c1", makeEntry({ database_instance_name: "my_mysql" })],
    ];

    const nodes = collectPhantomDatabaseInstances(entries, new Set());

    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.id).toBe("database-instance::my_mysql");
  });

  test("existing database instance creates no phantom", () => {
    const entries: [string, PlanEntry][] = [
      ["resources.synced_database_tables.t1", makeEntry({ database_instance_name: "my_pg" })],
    ];
    const existingKeys = new Set(["resources.database_instances.my_pg"]);

    const nodes = collectPhantomDatabaseInstances(entries, existingKeys);

    expect(nodes).toHaveLength(0);
  });

  test("multiple references to same instance produce single phantom", () => {
    const entries: [string, PlanEntry][] = [
      ["resources.synced_database_tables.t1", makeEntry({ database_instance_name: "my_pg" })],
      ["resources.synced_database_tables.t2", makeEntry({ database_instance_name: "my_pg" })],
      ["resources.database_catalogs.c1", makeEntry({ database_instance_name: "my_pg" })],
    ];

    const nodes = collectPhantomDatabaseInstances(entries, new Set());

    expect(nodes).toHaveLength(1);
  });

  test("phantom resourceKey uses dot-path form", () => {
    const entries: [string, PlanEntry][] = [
      ["resources.synced_database_tables.t1", makeEntry({ database_instance_name: "my_pg" })],
    ];

    const nodes = collectPhantomDatabaseInstances(entries, new Set());

    expect(nodes[0]?.resourceKey).toBe("resources.database_instances.my_pg");
    expect(nodes[0]?.id).toBe("database-instance::my_pg");
  });

  test("entry without database_instance_name creates no phantom", () => {
    const entries: [string, PlanEntry][] = [
      ["resources.synced_database_tables.t1", makeEntry({ name: "foo" })],
    ];

    const nodes = collectPhantomDatabaseInstances(entries, new Set());

    expect(nodes).toHaveLength(0);
  });

  test("non-database resource types are ignored", () => {
    const entries: [string, PlanEntry][] = [
      ["resources.jobs.j1", makeEntry({ database_instance_name: "my_pg" })],
    ];

    const nodes = collectPhantomDatabaseInstances(entries, new Set());

    expect(nodes).toHaveLength(0);
  });

  test("empty entries create no phantoms", () => {
    const nodes = collectPhantomDatabaseInstances([], new Set());

    expect(nodes).toHaveLength(0);
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

    const nodes = collectAppDependencies(entries);

    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({
      id: "job::123",
      label: "123",
      nodeKind: "phantom",
      diffState: "unchanged",
    });
  });

  test("app referencing existing job creates no phantom", () => {
    const entries: [string, PlanEntry][] = [
      [
        "resources.apps.myapp",
        makeAppEntry([{ job: { id: "123", permission_level: "IS_OWNER" } }]),
      ],
      ["resources.jobs.etl", makeEntry({ job_id: 123 })],
    ];

    const nodes = collectAppDependencies(entries);

    expect(nodes).toHaveLength(0);
  });

  test("app referencing absent sql_warehouse creates phantom", () => {
    const entries: [string, PlanEntry][] = [
      ["resources.apps.myapp", makeAppEntry([{ sql_warehouse: { id: "wh1" } }])],
    ];

    const nodes = collectAppDependencies(entries);

    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.id).toBe("sql-warehouse::wh1");
  });

  test("app referencing absent genie_space creates phantom", () => {
    const entries: [string, PlanEntry][] = [
      [
        "resources.apps.myapp",
        makeAppEntry([{ genie_space: { name: "taxi", space_id: "space-1" } }]),
      ],
    ];

    const nodes = collectAppDependencies(entries);

    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({
      id: "genie-space::taxi",
      resourceKey: "resources.genie_spaces.taxi",
    });
  });

  test("app referencing existing sql_warehouse creates no phantom", () => {
    const entries: [string, PlanEntry][] = [
      ["resources.apps.myapp", makeAppEntry([{ sql_warehouse: { id: "wh1" } }])],
    ];
    const indexes = {
      ...buildIndexes(entries),
      warehouseIndex: new Map([["wh1", "resources.sql_warehouses.main"]]),
    };

    const nodes = collectAppDependencies(entries, new Set(), indexes);

    expect(nodes).toHaveLength(0);
  });

  test("app referencing existing genie_space creates no phantom", () => {
    const entries: [string, PlanEntry][] = [
      [
        "resources.apps.myapp",
        makeAppEntry([{ genie_space: { name: "taxi", space_id: "space-1" } }]),
      ],
      ["resources.genie_spaces.taxi", makeEntry({ space_id: "space-1" })],
    ];

    const nodes = collectAppDependencies(entries);

    expect(nodes).toHaveLength(0);
  });

  test("app referencing absent secret_scope creates phantom", () => {
    const entries: [string, PlanEntry][] = [
      ["resources.apps.myapp", makeAppEntry([{ secret: { scope: "my_scope", key: "token" } }])],
    ];

    const nodes = collectAppDependencies(entries);

    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.id).toBe("secret-scope::my_scope");
    expect(nodes[0]?.resourceKey).toBe("resources.secret_scopes.my_scope");
  });

  test("app referencing existing secret_scope creates no phantom", () => {
    const entries: [string, PlanEntry][] = [
      ["resources.apps.myapp", makeAppEntry([{ secret: { scope: "my_scope", key: "token" } }])],
    ];
    const existingKeys = new Set(["resources.secret_scopes.my_scope"]);

    const nodes = collectAppDependencies(entries, existingKeys);

    expect(nodes).toHaveLength(0);
  });

  test("app referencing absent serving_endpoint creates phantom", () => {
    const entries: [string, PlanEntry][] = [
      [
        "resources.apps.myapp",
        makeAppEntry([{ serving_endpoint: { name: "llm_ep", permission: "CAN_QUERY" } }]),
      ],
    ];

    const nodes = collectAppDependencies(entries);

    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.id).toBe("serving-endpoint::llm_ep");
    expect(nodes[0]?.resourceKey).toBe("resources.model_serving_endpoints.llm_ep");
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

    const nodes = collectAppDependencies(entries);

    expect(nodes).toHaveLength(3);
    const ids = nodes.map((n) => n.id).sort();
    expect(ids).toEqual(["job::123", "secret-scope::s1", "sql-warehouse::wh1"]);
  });

  test("non-app entries are ignored", () => {
    const entries: [string, PlanEntry][] = [
      ["resources.jobs.j1", makeEntry({ resources: [{ job: { id: "123" } }] })],
    ];

    const nodes = collectAppDependencies(entries);

    expect(nodes).toHaveLength(0);
  });

  test("empty entries create no phantoms", () => {
    const nodes = collectAppDependencies([]);

    expect(nodes).toHaveLength(0);
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
    const nodes = collectExternalRefs(entries);

    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({
      id: "pipeline::p1",
      label: "p1",
      nodeKind: "phantom",
    });
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
    const nodes = collectExternalRefs(entries);

    const pipelinePhantoms = nodes.filter((n) => n.id.startsWith("pipeline::"));
    expect(pipelinePhantoms).toHaveLength(0);
  });

  test("first-deploy bundle interpolation creates no pipeline phantom", () => {
    const entries: [string, PlanEntry][] = [
      [
        "resources.jobs.runner",
        makeEntry({
          tasks: [
            {
              task_key: "t1",
              pipeline_task: {
                // biome-ignore lint/suspicious/noTemplateCurlyInString: Databricks interpolation syntax
                pipeline_id: "${resources.pipelines.etl.id}",
              },
            },
          ],
        }),
      ],
      ["resources.pipelines.etl", makeEntry({ name: "etl" })],
    ];

    const nodes = collectExternalRefs(entries);

    expect(nodes).toHaveLength(0);
  });

  test("synced-table pipeline references do not create phantoms", () => {
    const resourceKey = "resources.postgres_synced_tables.orders";
    // biome-ignore lint/suspicious/noTemplateCurlyInString: Databricks interpolation syntax
    const symbolicId = "${resources.postgres_synced_tables.orders.status.pipeline_id}";
    const entries: [string, PlanEntry][] = [
      [
        "resources.jobs.runner",
        makeEntry({
          tasks: [
            { task_key: "symbolic", pipeline_task: { pipeline_id: symbolicId } },
            { task_key: "concrete", pipeline_task: { pipeline_id: "pipeline-orders" } },
          ],
        }),
      ],
      [resourceKey, makeEntry({ pipeline_id: "pipeline-orders" })],
    ];

    const nodes = collectExternalRefs(entries);

    expect(nodes.filter((node) => node.id.startsWith("pipeline::"))).toHaveLength(0);
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
    const nodes = collectExternalRefs(entries);

    expect(nodes).toHaveLength(2);
    const ids = nodes.map((n) => n.id).sort();
    expect(ids).toEqual(["pipeline::p1", "sql-warehouse::wh1"]);
  });
});

describe("collectPhantomExistingPipelines", () => {
  test("creates one phantom for repeated external existing pipeline references", () => {
    const entries: [string, PlanEntry][] = [
      [
        "resources.postgres_synced_tables.orders",
        makeEntry({ existing_pipeline_id: "external-pipeline" }),
      ],
      [
        "resources.synced_database_tables.customers",
        makeEntry({ spec: { existing_pipeline_id: "external-pipeline" } }),
      ],
    ];

    const nodes = collectPhantomExistingPipelines(entries, new Set(), new Map());

    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({
      id: "pipeline::external-pipeline",
      label: "external-pipeline",
      nodeKind: "phantom",
    });
  });

  test("creates no phantom for symbolic or concrete managed pipeline references", () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: Databricks interpolation syntax
    const symbolicId = "${resources.pipelines.shared.id}";
    const pipelineKey = "resources.pipelines.shared";
    const entries: [string, PlanEntry][] = [
      ["resources.postgres_synced_tables.orders", makeEntry({ existing_pipeline_id: symbolicId })],
      [
        "resources.synced_database_tables.customers",
        makeEntry({ existing_pipeline_id: "pipeline-shared" }),
      ],
      [pipelineKey, makeEntry({ pipeline_id: "pipeline-shared" })],
    ];

    const nodes = collectPhantomExistingPipelines(
      entries,
      new Set([pipelineKey]),
      new Map([["pipeline-shared", pipelineKey]]),
    );

    expect(nodes).toHaveLength(0);
  });
});
