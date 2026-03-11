import { describe, expect, test } from "bun:test";
import { buildResourceGraph } from "../../src/graph/build-resource-graph.ts";
import { extractLateralEdges } from "../../src/graph/extract-lateral-edges.ts";
import type { PlanEntry } from "../../src/types/plan-schema.ts";
import { loadFixture } from "../helpers/load-fixture.ts";

// ---------------------------------------------------------------------------
// Helpers for building inline plan entries
// ---------------------------------------------------------------------------

const makeEntry = (state: Record<string, unknown>, action = "create"): PlanEntry =>
  ({
    action,
    new_state: { value: state },
  }) as PlanEntry;

const makeContext = (
  entries: readonly (readonly [string, PlanEntry])[],
  nodeOverrides?: ReadonlyMap<string, string>,
) => {
  const nodeIdByResourceKey = new Map<string, string>(entries.map(([key]) => [key, key]));
  if (nodeOverrides !== undefined) {
    for (const [k, v] of nodeOverrides) nodeIdByResourceKey.set(k, v);
  }
  const nodeIds = new Set<string>(nodeIdByResourceKey.values());
  return { entries, nodeIdByResourceKey, nodeIds };
};

// ---------------------------------------------------------------------------
// database_instance_name (synced_database_table → database_instance)
// ---------------------------------------------------------------------------

describe("extractDatabaseInstanceEdges", () => {
  test("synced table links to database instance when both exist", () => {
    const entries: [string, PlanEntry][] = [
      [
        "resources.synced_database_tables.customer_360",
        makeEntry({ database_instance_name: "analytics_db", name: "cat.schema.customer_360" }),
      ],
      ["resources.database_instances.analytics_db", makeEntry({ name: "analytics_db" })],
    ];

    const edges = extractLateralEdges(makeContext(entries));

    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({
      source: "resources.synced_database_tables.customer_360",
      target: "resources.database_instances.analytics_db",
      diffState: "unchanged",
    });
  });

  test("database_catalog links to database instance when both exist", () => {
    const entries: [string, PlanEntry][] = [
      [
        "resources.database_catalogs.lb_analytics",
        makeEntry({ database_instance_name: "analytics_db", name: "lb_analytics" }),
      ],
      ["resources.database_instances.analytics_db", makeEntry({ name: "analytics_db" })],
    ];

    const edges = extractLateralEdges(makeContext(entries));

    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({
      source: "resources.database_catalogs.lb_analytics",
      target: "resources.database_instances.analytics_db",
    });
  });

  test("no edge when target database instance is missing", () => {
    const entries: [string, PlanEntry][] = [
      [
        "resources.synced_database_tables.customer_360",
        makeEntry({ database_instance_name: "missing_db", name: "cat.schema.customer_360" }),
      ],
    ];

    const edges = extractLateralEdges(makeContext(entries));

    expect(edges).toHaveLength(0);
  });

  test("multiple edges from different sources to same instance", () => {
    const entries: [string, PlanEntry][] = [
      [
        "resources.synced_database_tables.t1",
        makeEntry({ database_instance_name: "db1", name: "c.s.t1" }),
      ],
      [
        "resources.synced_database_tables.t2",
        makeEntry({ database_instance_name: "db1", name: "c.s.t2" }),
      ],
      ["resources.database_instances.db1", makeEntry({ name: "db1" })],
    ];

    const edges = extractLateralEdges(makeContext(entries));

    expect(edges).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// warehouse_id (alert → sql_warehouse via API ID)
// ---------------------------------------------------------------------------

describe("extractWarehouseEdges", () => {
  test("alert links to warehouse via API ID", () => {
    const entries: [string, PlanEntry][] = [
      ["resources.alerts.data_freshness", makeEntry({ warehouse_id: "abc123" })],
      ["resources.sql_warehouses.analytics_wh", makeEntry({ id: "abc123", name: "analytics_wh" })],
    ];

    const edges = extractLateralEdges(makeContext(entries));

    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({
      source: "resources.alerts.data_freshness",
      target: "resources.sql_warehouses.analytics_wh",
      diffState: "unchanged",
    });
  });

  test("no edge when no warehouse in plan", () => {
    const entries: [string, PlanEntry][] = [
      ["resources.alerts.data_freshness", makeEntry({ warehouse_id: "abc123" })],
    ];

    const edges = extractLateralEdges(makeContext(entries));

    expect(edges).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// model_serving_endpoint → registered_model
// ---------------------------------------------------------------------------

describe("extractServingEndpointModelEdges", () => {
  test("endpoint links to registered model via served_entities", () => {
    const entries: [string, PlanEntry][] = [
      [
        "resources.model_serving_endpoints.predictor",
        makeEntry({
          config: {
            served_entities: [{ entity_name: "churn_model" }],
          },
        }),
      ],
      ["resources.registered_models.churn_model", makeEntry({ name: "churn_model" })],
    ];

    const edges = extractLateralEdges(makeContext(entries));

    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({
      source: "resources.model_serving_endpoints.predictor",
      target: "resources.registered_models.churn_model",
    });
  });

  test("no edge when model not in plan", () => {
    const entries: [string, PlanEntry][] = [
      [
        "resources.model_serving_endpoints.predictor",
        makeEntry({
          config: {
            served_entities: [{ entity_name: "missing_model" }],
          },
        }),
      ],
    ];

    const edges = extractLateralEdges(makeContext(entries));

    expect(edges).toHaveLength(0);
  });

  test("deduplicates when two served_entities reference the same model", () => {
    const entries: [string, PlanEntry][] = [
      [
        "resources.model_serving_endpoints.predictor",
        makeEntry({
          config: {
            served_entities: [{ entity_name: "churn_model" }, { entity_name: "churn_model" }],
          },
        }),
      ],
      ["resources.registered_models.churn_model", makeEntry({ name: "churn_model" })],
    ];

    const edges = extractLateralEdges(makeContext(entries));

    const modelEdges = edges.filter((e) => e.target.includes("registered_models"));
    expect(modelEdges).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Edge properties
// ---------------------------------------------------------------------------

describe("edge properties", () => {
  test("lateral edges have unchanged diffState and no label", () => {
    const entries: [string, PlanEntry][] = [
      [
        "resources.synced_database_tables.t1",
        makeEntry({ database_instance_name: "db1", name: "c.s.t1" }),
      ],
      ["resources.database_instances.db1", makeEntry({ name: "db1" })],
    ];

    const edges = extractLateralEdges(makeContext(entries));

    expect(edges[0]?.diffState).toBe("unchanged");
    expect(edges[0]?.label).toBeUndefined();
  });

  test("edge ID uses lateral:: prefix to avoid collisions with hierarchy edges", () => {
    const entries: [string, PlanEntry][] = [
      [
        "resources.synced_database_tables.t1",
        makeEntry({ database_instance_name: "db1", name: "c.s.t1" }),
      ],
      ["resources.database_instances.db1", makeEntry({ name: "db1" })],
    ];

    const edges = extractLateralEdges(makeContext(entries));

    expect(edges[0]?.id).toBe(
      "lateral::resources.synced_database_tables.t1→resources.database_instances.db1",
    );
  });

  test("empty entries produce no lateral edges", () => {
    const edges = extractLateralEdges(makeContext([]));

    expect(edges).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Source node guard consistency
// ---------------------------------------------------------------------------

describe("source node guard", () => {
  test("database instance edge skipped when source not in nodeIds", () => {
    const entries: [string, PlanEntry][] = [
      [
        "resources.synced_database_tables.orphan",
        makeEntry({ database_instance_name: "db1", name: "c.s.orphan" }),
      ],
      ["resources.database_instances.db1", makeEntry({ name: "db1" })],
    ];
    // Source key not in nodeIdByResourceKey → falls back to raw key, which won't be in nodeIds
    const nodeIdByResourceKey = new Map([
      ["resources.database_instances.db1", "resources.database_instances.db1"],
    ]);
    const nodeIds = new Set(nodeIdByResourceKey.values());

    const edges = extractLateralEdges({ entries, nodeIdByResourceKey, nodeIds });

    expect(edges).toHaveLength(0);
  });

  test("serving endpoint edge skipped when source not in nodeIds", () => {
    const entries: [string, PlanEntry][] = [
      [
        "resources.model_serving_endpoints.orphan",
        makeEntry({
          config: { served_entities: [{ entity_name: "model1" }] },
        }),
      ],
      ["resources.registered_models.model1", makeEntry({ name: "model1" })],
    ];
    const nodeIdByResourceKey = new Map([
      ["resources.registered_models.model1", "resources.registered_models.model1"],
    ]);
    const nodeIds = new Set(nodeIdByResourceKey.values());

    const edges = extractLateralEdges({ entries, nodeIdByResourceKey, nodeIds });

    expect(edges).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Container node ID remapping
// ---------------------------------------------------------------------------

describe("container node ID remapping", () => {
  test("uses hierarchy ID from nodeIdByResourceKey when source is a container", () => {
    const entries: [string, PlanEntry][] = [
      ["resources.database_catalogs.lb", makeEntry({ database_instance_name: "db1", name: "lb" })],
      ["resources.database_instances.db1", makeEntry({ name: "db1" })],
    ];
    const overrides = new Map([["resources.database_catalogs.lb", "catalog::lb"]]);

    const edges = extractLateralEdges(makeContext(entries, overrides));

    expect(edges[0]?.source).toBe("catalog::lb");
  });
});

// ---------------------------------------------------------------------------
// pipeline → catalog/schema (hierarchy-ID resolution)
// ---------------------------------------------------------------------------

describe("extractPipelineTargetEdges", () => {
  test("pipeline links to catalog via direct catalog field", () => {
    const entries: [string, PlanEntry][] = [
      ["resources.pipelines.ingest", makeEntry({ catalog: "production" })],
    ];
    const nodeIds = new Set(["resources.pipelines.ingest", "catalog::production"]);
    const nodeIdByResourceKey = new Map([
      ["resources.pipelines.ingest", "resources.pipelines.ingest"],
    ]);

    const edges = extractLateralEdges({ entries, nodeIdByResourceKey, nodeIds });

    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({
      source: "resources.pipelines.ingest",
      target: "catalog::production",
    });
  });

  test("pipeline links to both catalog and schema when target field present", () => {
    const entries: [string, PlanEntry][] = [
      ["resources.pipelines.ingest", makeEntry({ catalog: "production", target: "reporting" })],
    ];
    const nodeIds = new Set([
      "resources.pipelines.ingest",
      "catalog::production",
      "schema::production.reporting",
    ]);
    const nodeIdByResourceKey = new Map([
      ["resources.pipelines.ingest", "resources.pipelines.ingest"],
    ]);

    const edges = extractLateralEdges({ entries, nodeIdByResourceKey, nodeIds });

    expect(edges).toHaveLength(2);
    expect(edges.map((e) => e.target).toSorted()).toEqual([
      "catalog::production",
      "schema::production.reporting",
    ]);
  });

  test("no edge when catalog node missing from graph", () => {
    const entries: [string, PlanEntry][] = [
      ["resources.pipelines.ingest", makeEntry({ catalog: "missing" })],
    ];
    const nodeIds = new Set(["resources.pipelines.ingest"]);
    const nodeIdByResourceKey = new Map([
      ["resources.pipelines.ingest", "resources.pipelines.ingest"],
    ]);

    const edges = extractLateralEdges({ entries, nodeIdByResourceKey, nodeIds });

    expect(edges).toHaveLength(0);
  });

  test("deduplicates when direct target and ingestion_definition reference same schema", () => {
    const entries: [string, PlanEntry][] = [
      [
        "resources.pipelines.ingest",
        makeEntry({
          catalog: "production",
          target: "reporting",
          ingestion_definition: {
            objects: [{ schema: { source_catalog: "production", source_schema: "reporting" } }],
          },
        }),
      ],
    ];
    const nodeIds = new Set([
      "resources.pipelines.ingest",
      "catalog::production",
      "schema::production.reporting",
    ]);
    const nodeIdByResourceKey = new Map([
      ["resources.pipelines.ingest", "resources.pipelines.ingest"],
    ]);

    const edges = extractLateralEdges({ entries, nodeIdByResourceKey, nodeIds });

    // catalog + schema = 2 edges, NOT 3 (schema deduped)
    expect(edges).toHaveLength(2);
    expect(edges.map((e) => e.target).toSorted()).toEqual([
      "catalog::production",
      "schema::production.reporting",
    ]);
  });

  test("pipeline links to schema via ingestion_definition.objects", () => {
    const entries: [string, PlanEntry][] = [
      [
        "resources.pipelines.ingest",
        makeEntry({
          ingestion_definition: {
            objects: [{ schema: { source_catalog: "dagshund", source_schema: "analytics" } }],
          },
        }),
      ],
    ];
    const nodeIds = new Set(["resources.pipelines.ingest", "schema::dagshund.analytics"]);
    const nodeIdByResourceKey = new Map([
      ["resources.pipelines.ingest", "resources.pipelines.ingest"],
    ]);

    const edges = extractLateralEdges({ entries, nodeIdByResourceKey, nodeIds });

    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({
      source: "resources.pipelines.ingest",
      target: "schema::dagshund.analytics",
    });
  });
});

// ---------------------------------------------------------------------------
// source_table_full_name (synced_database_table → source-table phantom)
// ---------------------------------------------------------------------------

describe("extractSourceTableEdges", () => {
  test("synced table links to source-table phantom when both exist", () => {
    const entries: [string, PlanEntry][] = [
      [
        "resources.synced_database_tables.customer_360",
        makeEntry({
          name: "cat.schema.customer_360",
          spec: { source_table_full_name: "dagshund.analytics.customer_profiles" },
        }),
      ],
    ];
    const nodeIds = new Set([
      "resources.synced_database_tables.customer_360",
      "source-table::dagshund.analytics.customer_profiles",
    ]);
    const nodeIdByResourceKey = new Map([
      [
        "resources.synced_database_tables.customer_360",
        "resources.synced_database_tables.customer_360",
      ],
    ]);

    const edges = extractLateralEdges({ entries, nodeIdByResourceKey, nodeIds });

    const sourceTableEdges = edges.filter((e) => e.target.startsWith("source-table::"));
    expect(sourceTableEdges).toHaveLength(1);
    expect(sourceTableEdges[0]).toMatchObject({
      source: "resources.synced_database_tables.customer_360",
      target: "source-table::dagshund.analytics.customer_profiles",
      diffState: "unchanged",
    });
  });

  test("no edge when source_table_full_name is missing", () => {
    const entries: [string, PlanEntry][] = [
      [
        "resources.synced_database_tables.customer_360",
        makeEntry({ name: "cat.schema.customer_360" }),
      ],
    ];
    const nodeIds = new Set([
      "resources.synced_database_tables.customer_360",
      "source-table::dagshund.analytics.customer_profiles",
    ]);
    const nodeIdByResourceKey = new Map([
      [
        "resources.synced_database_tables.customer_360",
        "resources.synced_database_tables.customer_360",
      ],
    ]);

    const edges = extractLateralEdges({ entries, nodeIdByResourceKey, nodeIds });

    const sourceTableEdges = edges.filter((e) => e.target.startsWith("source-table::"));
    expect(sourceTableEdges).toHaveLength(0);
  });

  test("no edge when source_table_full_name is not a valid three-part name", () => {
    const entries: [string, PlanEntry][] = [
      [
        "resources.synced_database_tables.customer_360",
        makeEntry({
          name: "cat.schema.customer_360",
          spec: { source_table_full_name: "not_three_parts" },
        }),
      ],
    ];
    const nodeIds = new Set([
      "resources.synced_database_tables.customer_360",
      "source-table::not_three_parts",
    ]);
    const nodeIdByResourceKey = new Map([
      [
        "resources.synced_database_tables.customer_360",
        "resources.synced_database_tables.customer_360",
      ],
    ]);

    const edges = extractLateralEdges({ entries, nodeIdByResourceKey, nodeIds });

    const sourceTableEdges = edges.filter((e) => e.target.startsWith("source-table::"));
    expect(sourceTableEdges).toHaveLength(0);
  });

  test("no edge when source-table phantom not in nodeIds", () => {
    const entries: [string, PlanEntry][] = [
      [
        "resources.synced_database_tables.customer_360",
        makeEntry({
          name: "cat.schema.customer_360",
          spec: { source_table_full_name: "dagshund.analytics.customer_profiles" },
        }),
      ],
    ];
    // phantom NOT in nodeIds
    const nodeIds = new Set(["resources.synced_database_tables.customer_360"]);
    const nodeIdByResourceKey = new Map([
      [
        "resources.synced_database_tables.customer_360",
        "resources.synced_database_tables.customer_360",
      ],
    ]);

    const edges = extractLateralEdges({ entries, nodeIdByResourceKey, nodeIds });

    const sourceTableEdges = edges.filter((e) => e.target.startsWith("source-table::"));
    expect(sourceTableEdges).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// app → resources (nested resources[] array)
// ---------------------------------------------------------------------------

describe("extractAppResourceEdges", () => {
  test("app links to job via API ID reverse index", () => {
    const entries: [string, PlanEntry][] = [
      [
        "resources.apps.my_app",
        makeEntry({
          resources: [{ job: { id: "12345", permission: "CAN_MANAGE_RUN" }, name: "etl" }],
        }),
      ],
      ["resources.jobs.my_job", makeEntry({ job_id: 12345 })],
    ];

    const edges = extractLateralEdges(makeContext(entries));

    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({
      source: "resources.apps.my_app",
      target: "resources.jobs.my_job",
      diffState: "unchanged",
    });
  });

  test("app links to warehouse via API ID reverse index", () => {
    const entries: [string, PlanEntry][] = [
      [
        "resources.apps.my_app",
        makeEntry({
          resources: [
            { sql_warehouse: { id: "wh-abc", permission: "CAN_USE" }, name: "warehouse" },
          ],
        }),
      ],
      ["resources.sql_warehouses.analytics", makeEntry({ id: "wh-abc", name: "analytics" })],
    ];

    const edges = extractLateralEdges(makeContext(entries));

    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({
      source: "resources.apps.my_app",
      target: "resources.sql_warehouses.analytics",
    });
  });

  test("app links to secret scope via name-based key", () => {
    const entries: [string, PlanEntry][] = [
      [
        "resources.apps.my_app",
        makeEntry({
          resources: [
            { secret: { scope: "my-secrets", key: "token", permission: "READ" }, name: "secrets" },
          ],
        }),
      ],
      ["resources.secret_scopes.my-secrets", makeEntry({ name: "my-secrets" })],
    ];

    const edges = extractLateralEdges(makeContext(entries));

    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({
      source: "resources.apps.my_app",
      target: "resources.secret_scopes.my-secrets",
    });
  });

  test("app links to serving endpoint via name-based key", () => {
    const entries: [string, PlanEntry][] = [
      [
        "resources.apps.my_app",
        makeEntry({
          resources: [
            {
              serving_endpoint: { name: "predictor", permission: "CAN_MANAGE" },
              name: "endpoint",
            },
          ],
        }),
      ],
      ["resources.model_serving_endpoints.predictor", makeEntry({ name: "predictor" })],
    ];

    const edges = extractLateralEdges(makeContext(entries));

    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({
      source: "resources.apps.my_app",
      target: "resources.model_serving_endpoints.predictor",
    });
  });

  test("app links to experiment via API ID reverse index", () => {
    const entries: [string, PlanEntry][] = [
      [
        "resources.apps.my_app",
        makeEntry({
          resources: [
            { experiment: { id: "exp-999", permission: "CAN_MANAGE" }, name: "tracking" },
          ],
        }),
      ],
      ["resources.experiments.my_exp", makeEntry({ experiment_id: "exp-999" })],
    ];

    const edges = extractLateralEdges(makeContext(entries));

    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({
      source: "resources.apps.my_app",
      target: "resources.experiments.my_exp",
    });
  });

  test("no edge when API ID target missing and no phantom in nodeIds", () => {
    const entries: [string, PlanEntry][] = [
      [
        "resources.apps.my_app",
        makeEntry({
          resources: [
            { job: { id: "99999", permission: "CAN_MANAGE_RUN" }, name: "missing_job" },
            {
              sql_warehouse: { id: "missing-wh", permission: "CAN_USE" },
              name: "missing_warehouse",
            },
          ],
        }),
      ],
    ];

    const edges = extractLateralEdges(makeContext(entries));

    expect(edges).toHaveLength(0);
  });

  test("app links to phantom job when real job not in plan", () => {
    const entries: [string, PlanEntry][] = [
      [
        "resources.apps.my_app",
        makeEntry({
          resources: [{ job: { id: "99999", permission: "CAN_MANAGE_RUN" }, name: "etl" }],
        }),
      ],
    ];
    const nodeIdByResourceKey = new Map([
      ["resources.apps.my_app", "resources.apps.my_app"],
      ["job::99999", "job::99999"],
    ]);
    const nodeIds = new Set(nodeIdByResourceKey.values());

    const edges = extractLateralEdges({ entries, nodeIdByResourceKey, nodeIds });

    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({
      source: "resources.apps.my_app",
      target: "job::99999",
    });
  });

  test("app links to phantom warehouse when real warehouse not in plan", () => {
    const entries: [string, PlanEntry][] = [
      [
        "resources.apps.my_app",
        makeEntry({
          resources: [
            { sql_warehouse: { id: "wh-abc", permission: "CAN_USE" }, name: "warehouse" },
          ],
        }),
      ],
    ];
    const nodeIdByResourceKey = new Map([
      ["resources.apps.my_app", "resources.apps.my_app"],
      ["sql-warehouse::wh-abc", "sql-warehouse::wh-abc"],
    ]);
    const nodeIds = new Set(nodeIdByResourceKey.values());

    const edges = extractLateralEdges({ entries, nodeIdByResourceKey, nodeIds });

    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({
      source: "resources.apps.my_app",
      target: "sql-warehouse::wh-abc",
    });
  });

  test("app links to phantom experiment when real experiment not in plan", () => {
    const entries: [string, PlanEntry][] = [
      [
        "resources.apps.my_app",
        makeEntry({
          resources: [{ experiment: { id: "exp-42", permission: "CAN_MANAGE" }, name: "tracking" }],
        }),
      ],
    ];
    const nodeIdByResourceKey = new Map([
      ["resources.apps.my_app", "resources.apps.my_app"],
      ["experiment::exp-42", "experiment::exp-42"],
    ]);
    const nodeIds = new Set(nodeIdByResourceKey.values());

    const edges = extractLateralEdges({ entries, nodeIdByResourceKey, nodeIds });

    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({
      source: "resources.apps.my_app",
      target: "experiment::exp-42",
    });
  });

  test("app links to phantom serving endpoint when real endpoint not in plan", () => {
    const entries: [string, PlanEntry][] = [
      [
        "resources.apps.my_app",
        makeEntry({
          resources: [
            { serving_endpoint: { name: "predictor", permission: "CAN_MANAGE" }, name: "ep" },
          ],
        }),
      ],
    ];
    const nodeIdByResourceKey = new Map([
      ["resources.apps.my_app", "resources.apps.my_app"],
      ["resources.model_serving_endpoints.predictor", "serving-endpoint::predictor"],
    ]);
    const nodeIds = new Set(nodeIdByResourceKey.values());

    const edges = extractLateralEdges({ entries, nodeIdByResourceKey, nodeIds });

    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({
      source: "resources.apps.my_app",
      target: "serving-endpoint::predictor",
    });
  });

  test("empty resources array produces no edges", () => {
    const entries: [string, PlanEntry][] = [
      ["resources.apps.my_app", makeEntry({ resources: [] })],
    ];

    const edges = extractLateralEdges(makeContext(entries));

    expect(edges).toHaveLength(0);
  });

  test("multiple resource entries produce multiple edges", () => {
    const entries: [string, PlanEntry][] = [
      [
        "resources.apps.my_app",
        makeEntry({
          resources: [
            { job: { id: "111", permission: "CAN_MANAGE_RUN" }, name: "job1" },
            { job: { id: "222", permission: "CAN_MANAGE_RUN" }, name: "job2" },
          ],
        }),
      ],
      ["resources.jobs.first", makeEntry({ job_id: 111 })],
      ["resources.jobs.second", makeEntry({ job_id: 222 })],
    ];

    const edges = extractLateralEdges(makeContext(entries));

    const appEdges = edges.filter((e) => e.source === "resources.apps.my_app");
    expect(appEdges).toHaveLength(2);
  });

  test("deduplicates when same target referenced twice", () => {
    const entries: [string, PlanEntry][] = [
      [
        "resources.apps.my_app",
        makeEntry({
          resources: [
            { job: { id: "111", permission: "CAN_MANAGE_RUN" }, name: "ref1" },
            { job: { id: "111", permission: "CAN_MANAGE_RUN" }, name: "ref2" },
          ],
        }),
      ],
      ["resources.jobs.my_job", makeEntry({ job_id: 111 })],
    ];

    const edges = extractLateralEdges(makeContext(entries));

    const appEdges = edges.filter((e) => e.source === "resources.apps.my_app");
    expect(appEdges).toHaveLength(1);
  });

  test("unknown resource types are silently skipped", () => {
    const entries: [string, PlanEntry][] = [
      [
        "resources.apps.my_app",
        makeEntry({
          resources: [
            { some_future_type: { id: "foo" }, name: "unknown" },
            { job: { id: "111", permission: "CAN_MANAGE_RUN" }, name: "known" },
          ],
        }),
      ],
      ["resources.jobs.my_job", makeEntry({ job_id: 111 })],
    ];

    const edges = extractLateralEdges(makeContext(entries));

    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ target: "resources.jobs.my_job" });
  });

  test("job_id coerced from number to string for index lookup", () => {
    const entries: [string, PlanEntry][] = [
      [
        "resources.apps.my_app",
        makeEntry({
          resources: [{ job: { id: "283874357446614", permission: "CAN_MANAGE_RUN" }, name: "j" }],
        }),
      ],
      ["resources.jobs.etl", makeEntry({ job_id: 283874357446614 })],
    ];

    const edges = extractLateralEdges(makeContext(entries));

    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({
      source: "resources.apps.my_app",
      target: "resources.jobs.etl",
    });
  });
});

// ---------------------------------------------------------------------------
// Integration: all-hierarchies-plan.json
// ---------------------------------------------------------------------------

describe("all-hierarchies-plan integration", () => {
  test("extracts database instance edges from fixture", async () => {
    const plan = await loadFixture("all-hierarchies-plan.json");
    const graph = buildResourceGraph(plan);

    const dbInstanceEdges = graph.lateralEdges.filter(
      (e) => e.target.includes("database_instances") || e.target.startsWith("database-instance::"),
    );

    // customer_360 → analytics_db, product_events → analytics_db, lakebase_analytics → analytics_db,
    // partner_metrics → reporting_db (phantom)
    expect(dbInstanceEdges).toHaveLength(4);

    const sourceIds = dbInstanceEdges.map((e) => e.source).toSorted();
    expect(sourceIds).toContain("resources.synced_database_tables.customer_360");
    expect(sourceIds).toContain("resources.synced_database_tables.product_events");
    expect(sourceIds).toContain("resources.synced_database_tables.partner_metrics");
  });

  test("partner_metrics → reporting_db links to phantom database instance", async () => {
    const plan = await loadFixture("all-hierarchies-plan.json");
    const graph = buildResourceGraph(plan);

    const reportingEdges = graph.lateralEdges.filter(
      (e) =>
        e.source === "resources.synced_database_tables.partner_metrics" &&
        e.target.startsWith("database-instance::"),
    );

    expect(reportingEdges).toHaveLength(1);
    expect(reportingEdges[0]).toMatchObject({
      source: "resources.synced_database_tables.partner_metrics",
      target: "database-instance::reporting_db",
    });

    // The target should be a phantom node
    const phantomNode = graph.nodes.find((n) => n.id === "database-instance::reporting_db");
    expect(phantomNode).toBeDefined();
    expect(phantomNode?.nodeKind).toBe("phantom");
  });

  test("synced tables produce source-table edges to phantoms", async () => {
    const plan = await loadFixture("all-hierarchies-plan.json");
    const graph = buildResourceGraph(plan);

    const sourceTableEdges = graph.lateralEdges.filter((e) =>
      e.target.startsWith("source-table::"),
    );

    // customer_360 → customer_profiles, product_events → product_interactions, partner_metrics → partner_rollup
    expect(sourceTableEdges).toHaveLength(3);

    const targets = sourceTableEdges.map((e) => e.target).toSorted();
    expect(targets).toContain("source-table::dagshund.analytics.customer_profiles");
    expect(targets).toContain("source-table::dagshund.analytics.product_interactions");
    expect(targets).toContain("source-table::dagshund.integrations.partner_rollup");
  });
});

// ---------------------------------------------------------------------------
// Integration: apps.json
// ---------------------------------------------------------------------------

describe("apps.json integration", () => {
  test("app links to job via API ID reverse index", async () => {
    const plan = await loadFixture("apps.json");
    const graph = buildResourceGraph(plan);

    const appJobEdges = graph.lateralEdges.filter(
      (e) => e.source === "resources.apps.my_test_app" && e.target === "resources.jobs.my_etl_job",
    );

    expect(appJobEdges).toHaveLength(1);
  });

  test("phantom secret-scope node created for ss-kv112", async () => {
    const plan = await loadFixture("apps.json");
    const graph = buildResourceGraph(plan);

    const phantomNode = graph.nodes.find((n) => n.id === "secret-scope::ss-kv112");
    expect(phantomNode).toBeDefined();
    expect(phantomNode?.nodeKind).toBe("phantom");
    expect(phantomNode?.label).toBe("ss-kv112");
  });

  test("app links to phantom secret scope via lateral edge", async () => {
    const plan = await loadFixture("apps.json");
    const graph = buildResourceGraph(plan);

    const secretEdges = graph.lateralEdges.filter(
      (e) => e.source === "resources.apps.my_test_app" && e.target === "secret-scope::ss-kv112",
    );

    expect(secretEdges).toHaveLength(1);
  });

  test("phantom warehouse node created for missing warehouse API ID", async () => {
    const plan = await loadFixture("apps.json");
    const graph = buildResourceGraph(plan);

    const phantomNode = graph.nodes.find((n) => n.id === "sql-warehouse::88b556379679e44e");
    expect(phantomNode).toBeDefined();
    expect(phantomNode?.nodeKind).toBe("phantom");
    expect(phantomNode?.label).toBe("88b556379679e44e");
  });

  test("app links to phantom warehouse via lateral edge", async () => {
    const plan = await loadFixture("apps.json");
    const graph = buildResourceGraph(plan);

    const warehouseEdges = graph.lateralEdges.filter(
      (e) =>
        e.source === "resources.apps.my_test_app" && e.target === "sql-warehouse::88b556379679e44e",
    );

    expect(warehouseEdges).toHaveLength(1);
  });

  test("depends_on edge from job to app is preserved", async () => {
    const plan = await loadFixture("apps.json");
    const graph = buildResourceGraph(plan);

    const dependsOnEdges = graph.edges.filter(
      (e) => e.source === "resources.jobs.my_etl_job" && e.target === "resources.apps.my_test_app",
    );

    expect(dependsOnEdges).toHaveLength(1);
  });
});
