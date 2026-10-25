import { describe, expect, test } from "bun:test";
import { buildChainGraph } from "../../src/graph/build-hierarchy-graph.ts";
import { buildResourceGraph } from "../../src/graph/build-resource-graph.ts";
import { isJobEntry } from "../../src/graph/build-resource-nodes.ts";
import { extractStateField, parseThreePartName } from "../../src/graph/extract-resource-state.ts";
import { isPostgresType, isUnityCatalogType, UC_CHAIN } from "../../src/graph/hierarchy-specs.ts";
import { parsePlanJson } from "../../src/parser/parse-plan.ts";
import { preparePlan } from "../../src/preparation/prepare-plan.ts";
import type { ResourceGraphNode } from "../../src/types/graph-types.ts";
import { normalizePlan } from "../../src/utils/normalize-plan.ts";
import { extractResourceType } from "../../src/utils/resource-key.ts";
import {
  buildPlanGraphFromPlan,
  buildResourceGraphFromPlan,
} from "../helpers/build-graphs-from-plan.ts";
import { loadFixture } from "../helpers/load-fixture.ts";

describe("extractResourceType", () => {
  test("extracts type from standard resource key", () => {
    expect(extractResourceType("resources.schemas.analytics")).toBe("schemas");
  });

  test("extracts type from jobs key", () => {
    expect(extractResourceType("resources.jobs.etl_pipeline")).toBe("jobs");
  });

  test("returns undefined for single-segment key", () => {
    expect(extractResourceType("resources")).toBeUndefined();
  });
});

describe("isJobEntry", () => {
  test("returns true for job keys", () => {
    expect(isJobEntry("resources.jobs.my_job")).toBe(true);
  });

  test("returns false for schema keys", () => {
    expect(isJobEntry("resources.schemas.analytics")).toBe(false);
  });

  test("returns false for volume keys", () => {
    expect(isJobEntry("resources.volumes.raw_data")).toBe(false);
  });
});

describe("isUnityCatalogType", () => {
  test("returns true for UC types", () => {
    expect(isUnityCatalogType("schemas")).toBe(true);
    expect(isUnityCatalogType("volumes")).toBe(true);
    expect(isUnityCatalogType("registered_models")).toBe(true);
    expect(isUnityCatalogType("secrets")).toBe(true);
    expect(isUnityCatalogType("catalogs")).toBe(true);
    expect(isUnityCatalogType("database_catalogs")).toBe(true);
    expect(isUnityCatalogType("postgres_catalogs")).toBe(true);
    expect(isUnityCatalogType("synced_database_tables")).toBe(true);
  });

  test("returns false for non-UC types", () => {
    expect(isUnityCatalogType("dashboards")).toBe(false);
    expect(isUnityCatalogType("apps")).toBe(false);
    expect(isUnityCatalogType("jobs")).toBe(false);
  });
});

describe("prepared hierarchy inputs", () => {
  test("uses prepared current state for hierarchy identity and node state", () => {
    const key = "resources.catalogs.source";
    const plan = preparePlan(
      normalizePlan({
        [key]: { action: "create", new_state: { value: { name: "raw-catalog" } } },
      }),
    );
    const resource = plan.byResourceKey.get(key);
    if (resource === undefined) throw new Error("expected prepared catalog");
    const preparedPlan = {
      ...plan,
      byResourceKey: new Map([
        ...plan.byResourceKey,
        [
          key,
          {
            ...resource,
            currentState: { status: "supported" as const, value: { name: "prepared-catalog" } },
          },
        ],
      ]),
    };
    const graph = buildChainGraph(Object.entries(plan.normalized.entries), UC_CHAIN, preparedPlan);
    const catalog = graph.nodes.find((node) => node.resourceKey === key);

    expect(catalog?.id).toBe("catalog::prepared-catalog");
    expect(catalog?.resourceState).toEqual({ name: "prepared-catalog" });
    expect(catalog?.newState).toEqual({ value: { name: "raw-catalog" } });
  });
});

describe("extractStateField", () => {
  test("extracts field from new_state.value", () => {
    const entry = {
      action: "update" as const,
      new_state: { value: { catalog_name: "dagshund", name: "analytics" } },
    };
    expect(extractStateField(entry, "catalog_name")).toBe("dagshund");
  });

  test("falls back to remote_state for deleted resources", () => {
    const entry = {
      action: "delete" as const,
      remote_state: { catalog_name: "dagshund", schema_name: "analytics" },
    };
    expect(extractStateField(entry, "catalog_name")).toBe("dagshund");
    expect(extractStateField(entry, "schema_name")).toBe("analytics");
  });

  test("returns undefined when field is missing", () => {
    const entry = {
      action: "create" as const,
      new_state: { value: { name: "test" } },
    };
    expect(extractStateField(entry, "catalog_name")).toBeUndefined();
  });
});

describe("shared conventional reference resolution regressions", () => {
  test("symbolic existing-pipeline references retain the pipelines-only family policy", () => {
    const graph = buildResourceGraphFromPlan({
      plan: {
        "resources.synced_database_tables.consumer": {
          action: "create",
          new_state: {
            value: {
              existing_pipeline_id: "$" + "{resources.sql_warehouses.compute.id}",
            },
          },
        },
        "resources.sql_warehouses.compute": {
          action: "create",
          new_state: { value: { id: "warehouse-1" } },
        },
      },
    });

    expect(
      graph.edges.some(
        (edge) =>
          edge.source === "resources.synced_database_tables.consumer" &&
          edge.target === "resources.sql_warehouses.compute",
      ),
    ).toBe(false);
    expect(graph.nodes.some((node) => node.id.startsWith("pipeline::"))).toBe(true);
  });

  test("existing pipeline reference resolves to managed derived pipeline", () => {
    const graph = buildResourceGraphFromPlan({
      plan: {
        "resources.postgres_synced_tables.owner": {
          action: "create",
          new_state: { value: { pipeline_id: "generated-1" } },
        },
        "resources.synced_database_tables.consumer": {
          action: "create",
          new_state: { value: { existing_pipeline_id: "generated-1" } },
        },
      },
    });

    expect(graph.nodes.map((node) => node.id)).toContain("postgres-synced-pipeline::generated-1");
    expect(graph.nodes.map((node) => node.id)).not.toContain("pipeline::generated-1");
    expect(graph.lateralEdges).toContainEqual(
      expect.objectContaining({
        source: "resources.synced_database_tables.consumer",
        target: "postgres-synced-pipeline::generated-1",
      }),
    );
  });

  test("vector endpoint accepts only endpoint name references", () => {
    const graph = buildResourceGraphFromPlan({
      plan: {
        "resources.vector_search_indexes.wrong_type": {
          action: "create",
          new_state: { value: { endpoint_name: "${" + "resources.sql_warehouses.compute.name}" } },
        },
        "resources.vector_search_indexes.wrong_attribute": {
          action: "create",
          new_state: {
            value: { endpoint_name: "${" + "resources.vector_search_endpoints.compute.id}" },
          },
        },
        "resources.sql_warehouses.compute": {
          action: "create",
          new_state: { value: { id: "warehouse-1" } },
        },
        "resources.vector_search_endpoints.compute": {
          action: "create",
          new_state: { value: { name: "compute" } },
        },
      },
    });

    expect(
      graph.lateralEdges.some((edge) => edge.target === "resources.sql_warehouses.compute"),
    ).toBe(false);
    expect(
      graph.lateralEdges.some(
        (edge) => edge.source === "resources.vector_search_indexes.wrong_attribute",
      ),
    ).toBe(false);
  });

  test("vars-based run-job target is shared by resource and Jobs graphs", () => {
    const plan = {
      "resources.jobs.source": {
        action: "create" as const,
        new_state: {
          vars: {
            "tasks[0].run_job_task.job_id": "$" + "{resources.jobs.target.id}",
          },
          value: { tasks: [{ task_key: "trigger", run_job_task: { job_id: 0 } }] },
        },
      },
      "resources.jobs.target": {
        action: "create" as const,
        new_state: { value: { name: "target" } },
      },
    };
    const resourceGraph = buildResourceGraphFromPlan({ plan });
    const planGraph = buildPlanGraphFromPlan({ plan });

    expect(resourceGraph.lateralEdges).toContainEqual(
      expect.objectContaining({
        source: "resources.jobs.source",
        target: "resources.jobs.target",
      }),
    );
    expect(planGraph.edges).toContainEqual(
      expect.objectContaining({
        source: "resources.jobs.source::trigger",
        target: "resources.jobs.target",
      }),
    );
    expect(
      planGraph.nodes.find((node) => node.id === "resources.jobs.source::trigger")?.resourceState,
    ).toMatchObject({ run_job_task: { job_id: "0 (target)" } });
  });

  test("missing symbolic run-job targets are omitted from resource and Jobs graphs", () => {
    const plan = {
      plan: {
        "resources.jobs.source": {
          action: "create",
          new_state: {
            value: {
              tasks: [
                {
                  task_key: "trigger",
                  run_job_task: { job_id: "${" + "resources.jobs.missing.id}" },
                },
              ],
            },
          },
        },
      },
    } as const;

    const resourceGraph = buildResourceGraphFromPlan(plan);
    const jobsGraph = buildPlanGraphFromPlan(plan);

    expect(resourceGraph.edges.some((edge) => edge.target === "resources.jobs.missing")).toBe(
      false,
    );
    expect(resourceGraph.nodes.map((node) => node.id)).not.toContain("resources.jobs.missing");
    expect(jobsGraph.edges.some((edge) => edge.target === "resources.jobs.missing")).toBe(false);
    expect(jobsGraph.nodes.find((node) => node.nodeKind === "task")?.resourceState).toMatchObject({
      run_job_task: { job_id: "${" + "resources.jobs.missing.id}" },
    });
  });
});

describe("buildResourceGraph", () => {
  test("keeps promoted source-table identity precedence independent of owner order", () => {
    const entries = [
      ["resources.postgres_synced_tables.output", { synced_table_id: "cat.sch.output" }],
      [
        "resources.pipelines.events",
        { event_log: { catalog: "cat", schema: "sch", name: "output" } },
      ],
      ["resources.quality_monitors.monitor", { table_name: "cat.sch.output" }],
      [
        "resources.apps.app",
        { resources: [{ uc_securable: { securable_full_name: "cat.sch.output" } }] },
      ],
    ] as const;

    for (const orderedEntries of [entries, entries.toReversed()]) {
      const graph = buildResourceGraphFromPlan({
        plan: Object.fromEntries(
          orderedEntries.map(([key, value]) => [key, { action: "create", new_state: { value } }]),
        ),
      });
      const lateralPairs = graph.lateralEdges.map((edge) => `${edge.source}→${edge.target}`);

      expect(lateralPairs).toContain(
        "resources.quality_monitors.monitor→pipeline-event-log::cat.sch.output",
      );
      expect(lateralPairs).toContain("resources.apps.app→pipeline-event-log::cat.sch.output");
      expect(lateralPairs).not.toContain(
        "resources.quality_monitors.monitor→uc-synced-table::cat.sch.output",
      );
    }
  });

  test("keeps an owned event-log edge when pipeline ingestion references are also present", () => {
    const graph = buildResourceGraphFromPlan({
      plan: {
        "resources.pipelines.events": {
          action: "create",
          new_state: {
            value: {
              event_log: { catalog: "cat", schema: "sch", name: "output" },
              ingestion_definition: {
                objects: [{ schema: { source_catalog: "missing", source_schema: "raw" } }],
              },
            },
          },
        },
      },
    });

    expect(graph.lateralEdges.map((edge) => `${edge.source}→${edge.target}`)).toContain(
      "pipeline-event-log::cat.sch.output→resources.pipelines.events",
    );
  });

  test("suppresses a real source-table self-reference", () => {
    const graph = buildResourceGraphFromPlan({
      plan: {
        "resources.synced_database_tables.real": {
          action: "create",
          new_state: {
            value: { name: "cat.sch.output", spec: { source_table_full_name: "cat.sch.output" } },
          },
        },
      },
    });

    expect(
      graph.lateralEdges.some(
        (edge) =>
          edge.source === "resources.synced_database_tables.real" &&
          edge.target === "resources.synced_database_tables.real",
      ),
    ).toBe(false);
  });

  test("does not infer an external schema from ingestion alone", () => {
    const graph = buildResourceGraphFromPlan({
      plan: {
        "resources.pipelines.events": {
          action: "create",
          new_state: {
            value: {
              ingestion_definition: {
                objects: [{ schema: { source_catalog: "missing", source_schema: "raw" } }],
              },
            },
          },
        },
      },
    });

    expect(graph.nodes.map((node) => node.id)).not.toContain("schema::missing.raw");
    expect(graph.lateralEdges).toHaveLength(0);
  });

  test("resolves ingestion to a schema required by an existing source table", () => {
    const graph = buildResourceGraphFromPlan({
      plan: {
        "resources.synced_database_tables.source": {
          action: "create",
          new_state: { value: { name: "source", catalog_name: "missing", schema_name: "raw" } },
        },
        "resources.pipelines.events": {
          action: "create",
          new_state: {
            value: {
              ingestion_definition: {
                objects: [{ schema: { source_catalog: "missing", source_schema: "raw" } }],
              },
            },
          },
        },
      },
    });

    expect(graph.lateralEdges.map((edge) => `${edge.source}→${edge.target}`)).toContain(
      "resources.pipelines.events→schema::missing.raw",
    );
  });

  test("links ingestion to schemas required by UC leaves and serving models", () => {
    const ingestion = {
      action: "create",
      new_state: {
        value: {
          ingestion_definition: {
            objects: [{ schema: { source_catalog: "existing", source_schema: "raw" } }],
          },
        },
      },
    } as const;
    const existingResources = [
      ["resources.volumes.files", { catalog_name: "existing", schema_name: "raw", name: "files" }],
      [
        "resources.registered_models.model",
        { catalog_name: "existing", schema_name: "raw", name: "model" },
      ],
      ["resources.volumes.qualified", { name: "existing.raw.files" }],
      ["resources.registered_models.qualified", { name: "existing.raw.model" }],
      [
        "resources.model_serving_endpoints.endpoint",
        { config: { served_entities: [{ entity_name: "existing.raw.model" }] } },
      ],
    ] as const;

    for (const [resourceKey, value] of existingResources) {
      const graph = buildResourceGraphFromPlan({
        plan: {
          [resourceKey]: { action: "create", new_state: { value } },
          "resources.pipelines.ingest": ingestion,
        },
      });

      expect(graph.nodes.map((node) => node.id)).toContain("schema::existing.raw");
      expect(graph.lateralEdges.map((edge) => `${edge.source}→${edge.target}`)).toContain(
        "resources.pipelines.ingest→schema::existing.raw",
      );
    }
  });

  test("links ingestion to a schema already required by an app table reference", () => {
    const graph = buildResourceGraphFromPlan({
      plan: {
        "resources.apps.app": {
          action: "create",
          new_state: {
            value: { resources: [{ uc_securable: { securable_full_name: "missing.raw.table" } }] },
          },
        },
        "resources.pipelines.events": {
          action: "create",
          new_state: {
            value: {
              ingestion_definition: {
                objects: [{ schema: { source_catalog: "missing", source_schema: "raw" } }],
              },
            },
          },
        },
      },
    });

    expect(graph.lateralEdges.map((edge) => `${edge.source}→${edge.target}`)).toContain(
      "resources.pipelines.events→schema::missing.raw",
    );
  });

  test("preserves qualified table names when component fields are also present", () => {
    const graph = buildResourceGraphFromPlan({
      plan: {
        "resources.synced_database_tables.real": {
          action: "create",
          new_state: {
            value: { name: "cat.sch.output", catalog_name: "cat", schema_name: "sch" },
          },
        },
        "resources.quality_monitors.monitor": {
          action: "create",
          new_state: { value: { table_name: "cat.sch.output" } },
        },
      },
    });

    const lateralPairs = graph.lateralEdges.map((edge) => `${edge.source}→${edge.target}`);
    expect(lateralPairs).toContain(
      "resources.quality_monitors.monitor→resources.synced_database_tables.real",
    );
    expect(lateralPairs).not.toContain(
      "resources.quality_monitors.monitor→source-table::cat.sch.output",
    );
  });

  test("returns empty graph for empty plan", () => {
    const graph = buildResourceGraphFromPlan({});
    expect(graph.nodes).toHaveLength(0);
    expect(graph.edges).toHaveLength(0);
  });

  test("includes jobs as workspace resource nodes", () => {
    const graph = buildResourceGraphFromPlan({
      plan: { "resources.jobs.my_job": { action: "create" } },
    });

    const nodeIds = graph.nodes.map((n) => n.id);
    expect(nodeIds).toContain("workspace-root");
    expect(nodeIds).toContain("resources.jobs.my_job");
    expect(graph.nodes).toHaveLength(2);

    const jobNode = graph.nodes.find((n) => n.id === "resources.jobs.my_job");
    expect(jobNode?.diffState).toBe("added");
    expect(jobNode?.nodeKind).toBe("resource");

    const edgePairs = graph.edges.map((e) => `${e.source}→${e.target}`);
    expect(edgePairs).toContain("workspace-root→resources.jobs.my_job");
  });

  test("creates UC hierarchy for schema entries", () => {
    const graph = buildResourceGraphFromPlan({
      plan: {
        "resources.schemas.analytics": {
          action: "update",
          new_state: { value: { catalog_name: "dagshund", name: "analytics" } },
        },
      },
    });

    const nodeIds = graph.nodes.map((n) => n.id);
    expect(nodeIds).toContain("uc-root");
    expect(nodeIds).toContain("catalog::dagshund");
    expect(nodeIds).toContain("resources.schemas.analytics");

    // UC root → catalog → schema edges
    const edgePairs = graph.edges.map((e) => `${e.source}→${e.target}`);
    expect(edgePairs).toContain("uc-root→catalog::dagshund");
    expect(edgePairs).toContain("catalog::dagshund→resources.schemas.analytics");
  });

  test("links volumes to their schema", () => {
    const graph = buildResourceGraphFromPlan({
      plan: {
        "resources.schemas.analytics": {
          action: "update",
          new_state: { value: { catalog_name: "dagshund", name: "analytics" } },
        },
        "resources.volumes.raw_data": {
          action: "update",
          new_state: {
            value: { catalog_name: "dagshund", schema_name: "analytics", name: "raw_data" },
          },
        },
      },
    });

    const edgePairs = graph.edges.map((e) => `${e.source}→${e.target}`);
    expect(edgePairs).toContain("resources.schemas.analytics→resources.volumes.raw_data");
  });

  test("links registered_models to their schema", () => {
    const graph = buildResourceGraphFromPlan({
      plan: {
        "resources.schemas.analytics": {
          action: "update",
          new_state: { value: { catalog_name: "dagshund", name: "analytics" } },
        },
        "resources.registered_models.quality_metrics": {
          action: "delete",
          remote_state: {
            catalog_name: "dagshund",
            schema_name: "analytics",
            name: "quality_metrics",
          },
        },
      },
    });

    const edgePairs = graph.edges.map((e) => `${e.source}→${e.target}`);
    expect(edgePairs).toContain(
      "resources.schemas.analytics→resources.registered_models.quality_metrics",
    );
  });

  test("links secrets to a real schema without a duplicate phantom", () => {
    const graph = buildResourceGraphFromPlan({
      plan: {
        "resources.schemas.cli_resources": {
          action: "update",
          new_state: { value: { catalog_name: "dagshund", name: "cli_resources" } },
        },
        "resources.secrets.api_token": {
          action: "create",
          new_state: {
            value: {
              catalog_name: "dagshund",
              schema_name: "cli_resources",
              name: "api_token",
              value: "[redacted]",
            },
          },
        },
      },
    });

    const nodeIds = graph.nodes.map((node) => node.id);
    const edgePairs = graph.edges.map((edge) => `${edge.source}→${edge.target}`);
    expect(nodeIds).toContain("resources.secrets.api_token");
    expect(nodeIds).not.toContain("schema::dagshund.cli_resources");
    expect(edgePairs).toContain("resources.schemas.cli_resources→resources.secrets.api_token");
  });

  test("creates the standard phantom catalog and schema path for a secret", () => {
    const graph = buildResourceGraphFromPlan({
      plan: {
        "resources.secrets.api_token": {
          action: "create",
          new_state: {
            value: {
              catalog_name: "external_catalog",
              schema_name: "external_schema",
              name: "api_token",
              value: "[redacted]",
            },
          },
        },
      },
    });

    const catalog = graph.nodes.find((node) => node.id === "catalog::external_catalog");
    const schema = graph.nodes.find(
      (node) => node.id === "schema::external_catalog.external_schema",
    );
    const edgePairs = graph.edges.map((edge) => `${edge.source}→${edge.target}`);
    expect(catalog?.nodeKind).toBe("phantom");
    expect(schema?.nodeKind).toBe("phantom");
    expect(edgePairs).toContain("uc-root→catalog::external_catalog");
    expect(edgePairs).toContain(
      "catalog::external_catalog→schema::external_catalog.external_schema",
    );
    expect(edgePairs).toContain(
      "schema::external_catalog.external_schema→resources.secrets.api_token",
    );
  });

  test("creates phantom schema node when schema not in plan", () => {
    const graph = buildResourceGraphFromPlan({
      plan: {
        "resources.volumes.orphan_vol": {
          action: "create",
          new_state: {
            value: { catalog_name: "dagshund", schema_name: "missing", name: "orphan_vol" },
          },
        },
      },
    });

    // Phantom schema node should exist
    const phantom = graph.nodes.find((n) => n.id === "schema::dagshund.missing");
    expect(phantom).toBeDefined();
    expect(phantom?.nodeKind).toBe("phantom");
    expect(phantom?.label).toBe("missing");

    // Edge chain: catalog → phantom → volume
    const edgePairs = graph.edges.map((e) => `${e.source}→${e.target}`);
    expect(edgePairs).toContain("catalog::dagshund→schema::dagshund.missing");
    expect(edgePairs).toContain("schema::dagshund.missing→resources.volumes.orphan_vol");
  });

  test("falls back to catalog when both schema and catalog are missing", () => {
    const graph = buildResourceGraphFromPlan({
      plan: {
        "resources.volumes.no_schema": {
          action: "create",
          new_state: {
            value: { catalog_name: "dagshund", name: "no_schema" },
          },
        },
      },
    });

    const edgePairs = graph.edges.map((e) => `${e.source}→${e.target}`);
    expect(edgePairs).toContain("catalog::dagshund→resources.volumes.no_schema");
    // No phantom nodes
    const phantoms = graph.nodes.filter((n) => n.id.startsWith("schema::"));
    expect(phantoms).toHaveLength(0);
  });

  test("deduplicates phantom schema nodes for multiple resources", () => {
    const graph = buildResourceGraphFromPlan({
      plan: {
        "resources.volumes.vol_a": {
          action: "create",
          new_state: {
            value: { catalog_name: "dagshund", schema_name: "ext_schema", name: "vol_a" },
          },
        },
        "resources.volumes.vol_b": {
          action: "create",
          new_state: {
            value: { catalog_name: "dagshund", schema_name: "ext_schema", name: "vol_b" },
          },
        },
      },
    });

    // Only one phantom node despite two volumes referencing the same external schema
    const phantoms = graph.nodes.filter((n) => n.id === "schema::dagshund.ext_schema");
    expect(phantoms).toHaveLength(1);

    // Both volumes link through the phantom
    const edgePairs = graph.edges.map((e) => `${e.source}→${e.target}`);
    expect(edgePairs).toContain("schema::dagshund.ext_schema→resources.volumes.vol_a");
    expect(edgePairs).toContain("schema::dagshund.ext_schema→resources.volumes.vol_b");
  });

  test("real catalog entry creates resource node with hierarchy ID", () => {
    const graph = buildResourceGraphFromPlan({
      plan: {
        "resources.catalogs.dagshund": {
          action: "update",
          new_state: { value: { name: "dagshund" } },
        },
        "resources.schemas.analytics": {
          action: "update",
          new_state: { value: { catalog_name: "dagshund", name: "analytics" } },
        },
      },
    });

    const ucRoot = graph.nodes.find((n) => n.id === "uc-root");
    expect(ucRoot?.nodeKind).toBe("root");
    const catalog = graph.nodes.find((n) => n.id === "catalog::dagshund");
    expect(catalog?.nodeKind).toBe("resource");
  });

  test("catalog group node is phantom when catalog is not a plan entry", () => {
    const graph = buildResourceGraphFromPlan({
      plan: {
        "resources.schemas.analytics": {
          action: "update",
          new_state: { value: { catalog_name: "dagshund", name: "analytics" } },
        },
      },
    });

    const catalog = graph.nodes.find((n) => n.id === "catalog::dagshund");
    expect(catalog?.nodeKind).toBe("phantom");
  });

  test("resource nodes have nodeKind 'resource' (no external field)", () => {
    const graph = buildResourceGraphFromPlan({
      plan: {
        "resources.schemas.analytics": {
          action: "update",
          new_state: { value: { catalog_name: "dagshund", name: "analytics" } },
        },
      },
    });

    const schema = graph.nodes.find((n) => n.id === "resources.schemas.analytics");
    expect(schema?.nodeKind).toBe("resource");
    expect("external" in (schema ?? {})).toBe(false);
  });

  test("honors explicit depends_on edges", () => {
    const graph = buildResourceGraphFromPlan({
      plan: {
        "resources.schemas.analytics": {
          action: "update",
          new_state: { value: { catalog_name: "dagshund", name: "analytics" } },
        },
        "resources.volumes.raw_data": {
          depends_on: [{ node: "resources.schemas.analytics" }],
          action: "update",
          new_state: {
            value: { catalog_name: "dagshund", schema_name: "analytics", name: "raw_data" },
          },
        },
      },
    });

    // Should not have duplicate edges
    const edgePairs = graph.edges.map((e) => `${e.source}→${e.target}`);
    const schemaToVolume = edgePairs.filter(
      (p) => p === "resources.schemas.analytics→resources.volumes.raw_data",
    );
    expect(schemaToVolume).toHaveLength(1);
  });

  test("assigns correct diff states to resource nodes", () => {
    const graph = buildResourceGraphFromPlan({
      plan: {
        "resources.schemas.analytics": {
          action: "update",
          new_state: { value: { catalog_name: "dagshund", name: "analytics" } },
        },
        "resources.schemas.analytics_staging": {
          action: "create",
          new_state: { value: { catalog_name: "dagshund", name: "analytics_staging" } },
        },
      },
    });

    const schemaNode = graph.nodes.find((n) => n.id === "resources.schemas.analytics");
    expect(schemaNode?.diffState).toBe("modified");

    const stagingNode = graph.nodes.find((n) => n.id === "resources.schemas.analytics_staging");
    expect(stagingNode?.diffState).toBe("added");

    const ucRoot = graph.nodes.find((n) => n.id === "uc-root");
    expect(ucRoot?.diffState).toBe("unchanged");
    expect(ucRoot?.nodeKind).toBe("root");
  });

  test("does not create workspace root when all resources are UC", () => {
    const graph = buildResourceGraphFromPlan({
      plan: {
        "resources.schemas.analytics": {
          action: "update",
          new_state: { value: { catalog_name: "dagshund", name: "analytics" } },
        },
      },
    });

    const nodeIds = graph.nodes.map((n) => n.id);
    expect(nodeIds).not.toContain("workspace-root");
  });

  describe("mixed-changes fixture", () => {
    test("creates nodes for all 9 resources including jobs", async () => {
      const plan = await loadFixture("mixed-changes");
      const graph = buildResourceGraphFromPlan(plan);

      const resourceNodes = graph.nodes.filter((n) => n.nodeKind === "resource");
      expect(resourceNodes).toHaveLength(9);

      const resourceIds = resourceNodes.map((n) => n.id);
      expect(resourceIds).toContain("resources.schemas.analytics");
      expect(resourceIds).toContain("resources.schemas.analytics_staging");
      expect(resourceIds).toContain("resources.volumes.raw_data");
      expect(resourceIds).toContain("resources.volumes.old_exports");
      expect(resourceIds).toContain("resources.alerts.stale_pipeline_alert");
      expect(resourceIds).toContain("resources.experiments.audit_analysis");
      expect(resourceIds).toContain("resources.experiments.audit_analysis_final");
      expect(resourceIds).toContain("resources.jobs.data_quality_pipeline");
      expect(resourceIds).toContain("resources.jobs.etl_pipeline");
    });

    test("creates UC root, catalog phantom, and workspace root nodes", async () => {
      const plan = await loadFixture("mixed-changes");
      const graph = buildResourceGraphFromPlan(plan);

      const rootNodes = graph.nodes.filter((n) => n.nodeKind === "root");
      const rootIds = rootNodes.map((n) => n.id);
      expect(rootIds).toContain("uc-root");
      expect(rootIds).toContain("workspace-root");
      // dagshund catalog is phantom (no explicit catalogs entry in plan)
      const catalog = graph.nodes.find((n) => n.id === "catalog::dagshund");
      expect(catalog?.nodeKind).toBe("phantom");
    });

    test("deleted volume has removed diff state", async () => {
      const plan = await loadFixture("mixed-changes");
      const graph = buildResourceGraphFromPlan(plan);

      const volumeNode = graph.nodes.find((n) => n.id === "resources.volumes.old_exports");
      expect(volumeNode?.diffState).toBe("removed");
    });

    test("volume is linked to analytics schema", async () => {
      const plan = await loadFixture("mixed-changes");
      const graph = buildResourceGraphFromPlan(plan);

      const edgePairs = graph.edges.map((e) => `${e.source}→${e.target}`);
      expect(edgePairs).toContain("resources.schemas.analytics→resources.volumes.raw_data");
    });

    test("groups repeated types and collects remaining resources under Other Resources", async () => {
      const plan = await loadFixture("mixed-changes");
      const graph = buildResourceGraphFromPlan(plan);

      const edgePairs = graph.edges.map((e) => `${e.source}→${e.target}`);
      expect(edgePairs).toContain("workspace-root→other-resources-root");
      expect(edgePairs).toContain("other-resources-root→resources.alerts.stale_pipeline_alert");
      expect(edgePairs).toContain("other-resources-root→sql-warehouse::9d0afa601cb95187");
      expect(edgePairs).toContain("workspace-root→workspace-category::experiments");
      expect(edgePairs).toContain(
        "workspace-category::experiments→resources.experiments.audit_analysis",
      );
      expect(edgePairs).toContain("workspace-root→workspace-category::jobs");
      expect(edgePairs).toContain("workspace-category::jobs→resources.jobs.data_quality_pipeline");
      expect(edgePairs).toContain("workspace-category::jobs→resources.jobs.etl_pipeline");
    });
  });

  test("database_catalogs entry with child schema creates resource node with hierarchy ID", () => {
    const graph = buildResourceGraphFromPlan({
      plan: {
        "resources.database_catalogs.lakebase_cat": {
          action: "create",
          new_state: { value: { name: "lakebase_cat" } },
        },
        "resources.schemas.lb_schema": {
          action: "create",
          new_state: { value: { catalog_name: "lakebase_cat", name: "lb_schema" } },
        },
      },
    });

    // Container tier: database_catalogs entry uses hierarchy ID as node ID
    const catalog = graph.nodes.find((n) => n.id === "catalog::lakebase_cat");
    expect(catalog).toBeDefined();
    expect(catalog?.nodeKind).toBe("resource");

    const edgePairs = graph.edges.map((e) => `${e.source}→${e.target}`);
    expect(edgePairs).toContain("uc-root→catalog::lakebase_cat");
    expect(edgePairs).toContain("catalog::lakebase_cat→resources.schemas.lb_schema");
  });

  test("standalone database_catalogs entry appears under uc-root", () => {
    const graph = buildResourceGraphFromPlan({
      plan: {
        "resources.database_catalogs.standalone": {
          action: "create",
          new_state: { value: { name: "standalone" } },
        },
      },
    });

    const nodeIds = graph.nodes.map((n) => n.id);
    expect(nodeIds).toContain("uc-root");
    expect(nodeIds).toContain("catalog::standalone");

    const rootNodes = graph.nodes.filter((n) => n.nodeKind === "root");
    expect(rootNodes).toHaveLength(1); // only uc-root
  });

  // depends_on edges are not used for graph construction — they represent
  // deployment ordering, not semantic relationships. See buildResourceGraph comment.

  describe("job resource node filtering", () => {
    test("job resource node has taskChangeSummary when tasks have changes", () => {
      const graph = buildResourceGraphFromPlan({
        plan: {
          "resources.jobs.my_job": {
            action: "update",
            new_state: {
              value: {
                name: "my_job",
                tasks: [
                  { task_key: "ingest" },
                  { task_key: "transform", depends_on: [{ task_key: "ingest" }] },
                ],
              },
            },
            changes: {
              "tasks[task_key='transform'].notebook_task.notebook_path": {
                action: "update",
                old: "/old/path",
                new: "/new/path",
              },
            },
          },
        },
      });

      // Narrow the GraphNode union: .taskChangeSummary lives on ResourceGraphNode, not on the base union.
      const jobNode = graph.nodes.find(
        (n) => n.id === "resources.jobs.my_job",
      ) as ResourceGraphNode;
      expect(jobNode.taskChangeSummary).toBeDefined();
      expect(jobNode.taskChangeSummary).toHaveLength(1);
      const firstEntry = jobNode.taskChangeSummary?.[0];
      expect(firstEntry?.taskKey).toBe("transform");
      expect(firstEntry?.diffState).toBe("modified");
    });

    test("job resource node has task-level keys filtered from changes", () => {
      const graph = buildResourceGraphFromPlan({
        plan: {
          "resources.jobs.my_job": {
            action: "update",
            new_state: {
              value: {
                name: "my_job",
                tasks: [{ task_key: "ingest" }],
              },
            },
            changes: {
              name: { action: "update", old: "old_name", new: "my_job" },
              "tasks[task_key='ingest'].notebook_task.notebook_path": {
                action: "update",
                old: "/old",
                new: "/new",
              },
            },
          },
        },
      });

      const jobNode = graph.nodes.find(
        (n) => n.id === "resources.jobs.my_job",
      ) as ResourceGraphNode;
      expect(jobNode.changes).toBeDefined();
      expect(Object.keys(jobNode.changes ?? {})).toEqual(["name"]);
    });

    test("job resource node has tasks filtered from resourceState", () => {
      const graph = buildResourceGraphFromPlan({
        plan: {
          "resources.jobs.my_job": {
            action: "update",
            new_state: {
              value: {
                name: "my_job",
                max_concurrent_runs: 1,
                tasks: [{ task_key: "ingest" }],
              },
            },
          },
        },
      });

      const jobNode = graph.nodes.find(
        (n) => n.id === "resources.jobs.my_job",
      ) as ResourceGraphNode;
      expect(jobNode.resourceState).toBeDefined();
      expect(Object.keys(jobNode.resourceState ?? {})).toContain("name");
      expect(Object.keys(jobNode.resourceState ?? {})).toContain("max_concurrent_runs");
      expect(Object.keys(jobNode.resourceState ?? {})).not.toContain("tasks");
    });

    test("non-job resource node has taskChangeSummary undefined", () => {
      const graph = buildResourceGraphFromPlan({
        plan: {
          "resources.schemas.analytics": {
            action: "update",
            new_state: { value: { catalog_name: "dagshund", name: "analytics" } },
          },
        },
      });

      const schemaNode = graph.nodes.find(
        (n) => n.id === "resources.schemas.analytics",
      ) as ResourceGraphNode;
      expect(schemaNode.taskChangeSummary).toBeUndefined();
    });

    test("created job has taskChangeSummary undefined (all tasks inherit job state)", () => {
      const graph = buildResourceGraphFromPlan({
        plan: {
          "resources.jobs.new_job": {
            action: "create",
            new_state: {
              value: {
                name: "new_job",
                tasks: [
                  { task_key: "ingest" },
                  { task_key: "transform", depends_on: [{ task_key: "ingest" }] },
                ],
              },
            },
          },
        },
      });

      const jobNode = graph.nodes.find(
        (n) => n.id === "resources.jobs.new_job",
      ) as ResourceGraphNode;
      expect(jobNode.taskChangeSummary).toBeUndefined();
    });

    test("deleted job has taskChangeSummary undefined (all tasks inherit job state)", () => {
      const graph = buildResourceGraphFromPlan({
        plan: {
          "resources.jobs.old_job": {
            action: "delete",
            remote_state: { name: "old_job", job_id: 123 },
          },
        },
      });

      const jobNode = graph.nodes.find(
        (n) => n.id === "resources.jobs.old_job",
      ) as ResourceGraphNode;
      expect(jobNode.taskChangeSummary).toBeUndefined();
    });

    test("updated job with only job-level changes has taskChangeSummary undefined", () => {
      const graph = buildResourceGraphFromPlan({
        plan: {
          "resources.jobs.my_job": {
            action: "update",
            new_state: {
              value: {
                name: "my_job",
                tasks: [{ task_key: "ingest" }],
              },
            },
            changes: {
              name: { action: "update", old: "old_name", new: "my_job" },
            },
          },
        },
      });

      const jobNode = graph.nodes.find(
        (n) => n.id === "resources.jobs.my_job",
      ) as ResourceGraphNode;
      expect(jobNode.taskChangeSummary).toBeUndefined();
    });

    test("job with no tasks has taskChangeSummary undefined", () => {
      const graph = buildResourceGraphFromPlan({
        plan: {
          "resources.jobs.empty_job": {
            action: "update",
            new_state: {
              value: { name: "empty_job" },
            },
          },
        },
      });

      const jobNode = graph.nodes.find(
        (n) => n.id === "resources.jobs.empty_job",
      ) as ResourceGraphNode;
      expect(jobNode.taskChangeSummary).toBeUndefined();
    });
  });
});

describe("isPostgresType", () => {
  test("returns true for postgres types", () => {
    expect(isPostgresType("postgres_projects")).toBe(true);
    expect(isPostgresType("postgres_branches")).toBe(true);
    expect(isPostgresType("postgres_databases")).toBe(true);
    expect(isPostgresType("postgres_endpoints")).toBe(true);
    expect(isPostgresType("postgres_roles")).toBe(true);
    expect(isPostgresType("postgres_synced_tables")).toBe(true);
  });

  test("returns false for non-postgres types", () => {
    expect(isPostgresType("jobs")).toBe(false);
    expect(isPostgresType("database_instances")).toBe(false);
    expect(isPostgresType("schemas")).toBe(false);
    expect(isPostgresType("postgres_catalogs")).toBe(false);
  });
});

describe("postgres hierarchy", () => {
  test("status postgres_database identity resolves real hierarchy and catalog target", () => {
    const branchRef = "projects/demo/branches/main";
    const graph = buildResourceGraphFromPlan({
      plan: {
        "resources.postgres_branches.main": {
          action: "create",
          new_state: { value: { branch_id: "main", parent: "projects/demo" } },
        },
        "resources.postgres_databases.db": {
          action: "create",
          new_state: { value: { parent: branchRef, status: { postgres_database: "app_db" } } },
        },
        "resources.postgres_catalogs.catalog": {
          action: "create",
          new_state: {
            value: {
              branch: branchRef,
              postgres_database: "app_db",
              catalog_id: "app_catalog",
            },
          },
        },
      },
    });

    expect(graph.nodes.map((node) => node.id)).toContain("resources.postgres_databases.db");
    expect(graph.nodes.map((node) => node.id)).not.toContain("postgres-database::demo/main/app_db");
    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        source: "resources.postgres_branches.main",
        target: "resources.postgres_databases.db",
      }),
    );
    expect(graph.lateralEdges).toContainEqual(
      expect.objectContaining({
        source: "catalog::app_catalog",
        target: "resources.postgres_databases.db",
      }),
    );
  });

  test("symbolic Postgres relationships resolve without concrete branch identities", () => {
    const projectRef = "$" + "{resources.postgres_projects.demo.id}";
    const mainRef = "$" + "{resources.postgres_branches.main.id}";
    const baseRef = "$" + "{resources.postgres_branches.base.id}";
    const graph = buildResourceGraphFromPlan({
      plan: {
        "resources.postgres_projects.demo": {
          action: "create",
          new_state: { value: { project_id: "demo" } },
        },
        "resources.postgres_branches.main": {
          action: "create",
          new_state: { value: { branch_id: "main", parent: projectRef, source_branch: baseRef } },
        },
        "resources.postgres_branches.base": {
          action: "create",
          new_state: { value: { branch_id: "base", parent: projectRef } },
        },
        "resources.postgres_databases.db": {
          action: "create",
          new_state: { value: { parent: mainRef, postgres_database: "app_db" } },
        },
        "resources.postgres_catalogs.catalog": {
          action: "create",
          new_state: {
            value: {
              branch: mainRef,
              postgres_database: "app_db",
              catalog_id: "app_catalog",
            },
          },
        },
        "resources.postgres_synced_tables.table": {
          action: "create",
          new_state: {
            value: { branch: mainRef, postgres_database: "app_db", synced_table_id: "table" },
          },
        },
      },
    });

    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        source: "resources.postgres_branches.main",
        target: "resources.postgres_databases.db",
      }),
    );
    expect(graph.lateralEdges).toContainEqual(
      expect.objectContaining({
        source: "resources.postgres_branches.main",
        target: "resources.postgres_branches.base",
      }),
    );
    expect(graph.lateralEdges).toContainEqual(
      expect.objectContaining({
        source: "catalog::app_catalog",
        target: "resources.postgres_databases.db",
      }),
    );
  });

  test("opaque fields from another Postgres family do not invalidate branch relationships", () => {
    const graph = buildResourceGraphFromPlan({
      plan: {
        "resources.postgres_branches.main": {
          action: "create",
          new_state: {
            value: { branch_id: "main", parent: "projects/demo", role: { opaque: true } },
          },
        },
        "resources.postgres_endpoints.endpoint": {
          action: "create",
          new_state: {
            value: {
              endpoint_id: "endpoint",
              parent: "projects/demo/branches/main",
              endpoint_type: "ENDPOINT_TYPE_READ_WRITE",
            },
          },
        },
      },
    });

    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        source: "resources.postgres_branches.main",
        target: "resources.postgres_endpoints.endpoint",
      }),
    );
    expect(graph.nodes.map((node) => node.id)).not.toContain("postgres-branch::demo/main");
  });
  test("full chain: workspace-root → postgres-root → project group → branch → endpoint", () => {
    const graph = buildResourceGraphFromPlan({
      plan: {
        "resources.postgres_projects.my_project": {
          action: "create",
          new_state: { value: { project_id: "my-project", display_name: "My Project" } },
        },
        "resources.postgres_branches.my_branch": {
          action: "create",
          new_state: { value: { branch_id: "my-branch", parent: "projects/my-project" } },
        },
        "resources.postgres_endpoints.my_endpoint": {
          action: "create",
          new_state: {
            value: {
              endpoint_id: "my-endpoint",
              parent: "projects/my-project/branches/my-branch",
              endpoint_type: "ENDPOINT_TYPE_READ_WRITE",
            },
          },
        },
      },
    });

    const nodeIds = graph.nodes.map((n) => n.id);
    expect(nodeIds).toContain("workspace-root");
    expect(nodeIds).toContain("postgres-root");
    expect(nodeIds).toContain("postgres-project::my-project");
    expect(nodeIds).toContain("resources.postgres_branches.my_branch");
    expect(nodeIds).toContain("resources.postgres_endpoints.my_endpoint");

    const edgePairs = graph.edges.map((e) => `${e.source}→${e.target}`);
    expect(edgePairs).toContain("workspace-root→postgres-root");
    expect(edgePairs).toContain("postgres-root→postgres-project::my-project");
    expect(edgePairs).toContain(
      "postgres-project::my-project→resources.postgres_branches.my_branch",
    );
    expect(edgePairs).toContain(
      "resources.postgres_branches.my_branch→resources.postgres_endpoints.my_endpoint",
    );

    const projectNode = graph.nodes.find((n) => n.id === "postgres-project::my-project");
    expect(projectNode?.nodeKind).toBe("resource");
  });

  test("phantom branch when branch not in plan hangs off phantom project", () => {
    const graph = buildResourceGraphFromPlan({
      plan: {
        "resources.postgres_endpoints.my_endpoint": {
          action: "create",
          new_state: {
            value: {
              endpoint_id: "my-endpoint",
              parent: "projects/some-project/branches/missing-branch",
              endpoint_type: "ENDPOINT_TYPE_READ_ONLY",
            },
          },
        },
      },
    });

    const nodeIds = graph.nodes.map((n) => n.id);
    expect(nodeIds).toContain("postgres-branch::some-project/missing-branch");

    const phantom = graph.nodes.find(
      (n) => n.id === "postgres-branch::some-project/missing-branch",
    );
    expect(phantom?.nodeKind).toBe("phantom");

    const edgePairs = graph.edges.map((e) => `${e.source}→${e.target}`);
    expect(edgePairs).toContain(
      "postgres-project::some-project→postgres-branch::some-project/missing-branch",
    );
    expect(edgePairs).toContain(
      "postgres-branch::some-project/missing-branch→resources.postgres_endpoints.my_endpoint",
    );
  });

  test("endpoint bundle parent ref resolves to branch resource", () => {
    const branchIdRef = "$" + "{resources.postgres_branches.dev_branch.id}";
    const graph = buildResourceGraphFromPlan({
      plan: {
        "resources.postgres_branches.dev_branch": {
          action: "create",
          new_state: { value: { branch_id: "dev", parent: "projects/dagshund" } },
        },
        "resources.postgres_endpoints.dev_endpoint": {
          action: "create",
          new_state: {
            value: {
              endpoint_id: "primary",
              parent: branchIdRef,
              endpoint_type: "ENDPOINT_TYPE_READ_WRITE",
            },
          },
        },
      },
    });

    const edgePairs = graph.edges.map((e) => `${e.source}→${e.target}`);
    expect(edgePairs).toContain(
      "resources.postgres_branches.dev_branch→resources.postgres_endpoints.dev_endpoint",
    );
    expect(edgePairs).not.toContain("postgres-root→resources.postgres_endpoints.dev_endpoint");
  });

  test("branch children resolve to branch resource from parent or branch fields", () => {
    const branchIdRef = "$" + "{resources.postgres_branches.dev_branch.id}";
    const graph = buildResourceGraphFromPlan({
      plan: {
        "resources.postgres_branches.dev_branch": {
          action: "create",
          new_state: { value: { branch_id: "dev", parent: "projects/dagshund" } },
        },
        "resources.postgres_databases.app_database": {
          action: "create",
          new_state: {
            value: {
              parent: branchIdRef,
              database_id: "app-db",
              postgres_database: "app_db",
            },
          },
        },
        "resources.postgres_roles.data_engineers": {
          action: "create",
          new_state: {
            value: {
              parent: branchIdRef,
              role_id: "data-engineers",
              postgres_role: "data_engineers",
            },
          },
        },
        "resources.postgres_synced_tables.phantom_table": {
          action: "create",
          new_state: {
            value: {
              branch: branchIdRef,
              postgres_database: "app_db",
              source_table_full_name: "dagshund.phantom_schema.phantom_table",
              synced_table_id: "dagshund_lakebase.public.phantom_table",
            },
          },
        },
      },
    });

    const edgePairs = graph.edges.map((e) => `${e.source}→${e.target}`);
    expect(edgePairs).toContain(
      "resources.postgres_branches.dev_branch→resources.postgres_databases.app_database",
    );
    expect(edgePairs).toContain(
      "resources.postgres_branches.dev_branch→resources.postgres_roles.data_engineers",
    );
    expect(edgePairs).toContain(
      "resources.postgres_databases.app_database→resources.postgres_synced_tables.phantom_table",
    );
  });

  test("derived branch has lateral lineage edge to source branch", () => {
    const graph = buildResourceGraphFromPlan({
      plan: {
        "resources.postgres_branches.dev_branch": {
          action: "create",
          new_state: {
            value: {
              branch_id: "dev",
              parent: "projects/dagshund",
              source_branch: "projects/dagshund/branches/prd",
            },
          },
        },
        "resources.postgres_branches.prd_branch": {
          action: "update",
          new_state: { value: { branch_id: "prd", parent: "projects/dagshund" } },
        },
      },
    });

    const edgePairs = graph.edges.map((e) => `${e.source}→${e.target}`);
    expect(edgePairs).toContain(
      "postgres-project::dagshund→resources.postgres_branches.dev_branch",
    );
    expect(edgePairs).toContain(
      "postgres-project::dagshund→resources.postgres_branches.prd_branch",
    );
    expect(edgePairs).not.toContain(
      "resources.postgres_branches.prd_branch→resources.postgres_branches.dev_branch",
    );

    const lateralEdgePairs = graph.lateralEdges.map((e) => `${e.source}→${e.target}`);
    expect(lateralEdgePairs).toContain(
      "resources.postgres_branches.dev_branch→resources.postgres_branches.prd_branch",
    );
  });

  test("derived branch creates phantom source branch when source is external", () => {
    const graph = buildResourceGraphFromPlan({
      plan: {
        "resources.postgres_branches.dev_branch": {
          action: "create",
          new_state: {
            value: {
              branch_id: "dev",
              parent: "projects/dagshund",
              source_branch: "projects/phantom-lineage-lakebase/branches/production",
            },
          },
        },
      },
    });

    const nodeIds = graph.nodes.map((n) => n.id);
    expect(nodeIds).toContain("postgres-project::phantom-lineage-lakebase");
    expect(nodeIds).toContain("postgres-branch::phantom-lineage-lakebase/production");

    const edgePairs = graph.edges.map((e) => `${e.source}→${e.target}`);
    expect(edgePairs).toContain("postgres-root→postgres-project::phantom-lineage-lakebase");
    expect(edgePairs).toContain(
      "postgres-project::phantom-lineage-lakebase→postgres-branch::phantom-lineage-lakebase/production",
    );

    const lateralEdgePairs = graph.lateralEdges.map((e) => `${e.source}→${e.target}`);
    expect(lateralEdgePairs).toContain(
      "resources.postgres_branches.dev_branch→postgres-branch::phantom-lineage-lakebase/production",
    );
  });

  test("lakebase-autoscaling fixture creates external lineage phantom only", async () => {
    const graph = buildResourceGraphFromPlan(await loadFixture("lakebase-autoscaling"));

    const nodeIds = graph.nodes.map((n) => n.id);
    expect(nodeIds).not.toContain("postgres-project::phantom-lakebase");
    expect(nodeIds).not.toContain("postgres-branch::phantom-lakebase/production");
    expect(nodeIds).toContain("postgres-project::phantom-lineage-lakebase");
    expect(nodeIds).toContain("postgres-branch::phantom-lineage-lakebase/production");
    expect(nodeIds).not.toContain("resources.postgres_endpoints.external_reader_endpoint");

    const edgePairs = graph.edges.map((e) => `${e.source}→${e.target}`);
    expect(edgePairs).not.toContain(
      "postgres-branch::phantom-lakebase/production→resources.postgres_endpoints.external_reader_endpoint",
    );
    expect(edgePairs).toContain(
      "postgres-project::phantom-lineage-lakebase→resources.postgres_branches.external_lineage_branch",
    );

    const lateralEdgePairs = graph.lateralEdges.map((e) => `${e.source}→${e.target}`);
    expect(lateralEdgePairs).toContain(
      "resources.postgres_branches.external_lineage_branch→postgres-branch::phantom-lineage-lakebase/production",
    );
  });

  test("project group is external when no project entry exists", () => {
    const graph = buildResourceGraphFromPlan({
      plan: {
        "resources.postgres_branches.my_branch": {
          action: "create",
          new_state: { value: { branch_id: "my-branch", parent: "projects/ext-project" } },
        },
      },
    });

    const projectNode = graph.nodes.find((n) => n.id === "postgres-project::ext-project");
    expect(projectNode).toBeDefined();
    expect(projectNode?.nodeKind).toBe("phantom");
  });

  test("endpoint with no parent field falls back to postgres-root", () => {
    const graph = buildResourceGraphFromPlan({
      plan: {
        "resources.postgres_endpoints.orphan": {
          action: "create",
          new_state: { value: { endpoint_id: "orphan" } },
        },
      },
    });

    const edgePairs = graph.edges.map((e) => `${e.source}→${e.target}`);
    expect(edgePairs).toContain("postgres-root→resources.postgres_endpoints.orphan");
  });

  test("standalone project appears under postgres-root", () => {
    const graph = buildResourceGraphFromPlan({
      plan: {
        "resources.postgres_projects.solo": {
          action: "create",
          new_state: { value: { project_id: "solo" } },
        },
      },
    });

    const nodeIds = graph.nodes.map((n) => n.id);
    expect(nodeIds).toContain("workspace-root");
    expect(nodeIds).toContain("postgres-root");
    // Container tier: uses hierarchy ID, no separate plan-key node
    expect(nodeIds).toContain("postgres-project::solo");

    const edgePairs = graph.edges.map((e) => `${e.source}→${e.target}`);
    expect(edgePairs).toContain("workspace-root→postgres-root");
    expect(edgePairs).toContain("postgres-root→postgres-project::solo");
  });

  test("no postgres-root when no postgres resources", () => {
    const graph = buildResourceGraphFromPlan({
      plan: {
        "resources.jobs.my_job": { action: "create" },
      },
    });

    const nodeIds = graph.nodes.map((n) => n.id);
    expect(nodeIds).not.toContain("postgres-root");
  });
});

describe("synced_database_tables in UC", () => {
  test("three-part name places synced table under catalog → schema in UC", () => {
    const graph = buildResourceGraphFromPlan({
      plan: {
        "resources.schemas.analytics": {
          action: "update",
          new_state: { value: { catalog_name: "dagshund", name: "analytics" } },
        },
        "resources.synced_database_tables.my_table": {
          action: "create",
          new_state: {
            value: { name: "dagshund.analytics.my_table" },
          },
        },
      },
    });

    const nodeIds = graph.nodes.map((n) => n.id);
    expect(nodeIds).toContain("uc-root");
    expect(nodeIds).toContain("resources.synced_database_tables.my_table");

    const edgePairs = graph.edges.map((e) => `${e.source}→${e.target}`);
    // Synced table under real schema
    expect(edgePairs).toContain(
      "resources.schemas.analytics→resources.synced_database_tables.my_table",
    );
  });

  test("phantom schema created when schema not in plan", () => {
    const graph = buildResourceGraphFromPlan({
      plan: {
        "resources.catalogs.prod": {
          action: "create",
          new_state: { value: { name: "prod" } },
        },
        "resources.synced_database_tables.my_table": {
          action: "create",
          new_state: {
            value: { name: "prod.missing_schema.my_table" },
          },
        },
      },
    });

    const nodeIds = graph.nodes.map((n) => n.id);
    expect(nodeIds).toContain("schema::prod.missing_schema");
    expect(nodeIds).toContain("resources.synced_database_tables.my_table");

    const edgePairs = graph.edges.map((e) => `${e.source}→${e.target}`);
    expect(edgePairs).toContain("catalog::prod→schema::prod.missing_schema");
    expect(edgePairs).toContain(
      "schema::prod.missing_schema→resources.synced_database_tables.my_table",
    );
  });

  test("simple name (no three-part) falls to uc-root", () => {
    const graph = buildResourceGraphFromPlan({
      plan: {
        "resources.synced_database_tables.orphan": {
          action: "create",
          new_state: { value: { name: "orphan" } },
        },
      },
    });

    const edgePairs = graph.edges.map((e) => `${e.source}→${e.target}`);
    expect(edgePairs).toContain("uc-root→resources.synced_database_tables.orphan");
  });

  test("bootstraps UC root when only synced table exists", () => {
    const graph = buildResourceGraphFromPlan({
      plan: {
        "resources.synced_database_tables.my_table": {
          action: "create",
          new_state: {
            value: { name: "new_catalog.new_schema.my_table" },
          },
        },
      },
    });

    const nodeIds = graph.nodes.map((n) => n.id);
    expect(nodeIds).toContain("uc-root");
    expect(nodeIds).toContain("catalog::new_catalog");
    expect(nodeIds).toContain("schema::new_catalog.new_schema");
    expect(nodeIds).toContain("resources.synced_database_tables.my_table");

    const edgePairs = graph.edges.map((e) => `${e.source}→${e.target}`);
    expect(edgePairs).toContain("uc-root→catalog::new_catalog");
    expect(edgePairs).toContain("catalog::new_catalog→schema::new_catalog.new_schema");
    expect(edgePairs).toContain(
      "schema::new_catalog.new_schema→resources.synced_database_tables.my_table",
    );
  });

  test("multiple synced tables under same schema each get their own node", () => {
    const graph = buildResourceGraphFromPlan({
      plan: {
        "resources.schemas.analytics": {
          action: "update",
          new_state: { value: { catalog_name: "dagshund", name: "analytics" } },
        },
        "resources.synced_database_tables.table_a": {
          action: "create",
          new_state: {
            value: { name: "dagshund.analytics.table_a" },
          },
        },
        "resources.synced_database_tables.table_b": {
          action: "create",
          new_state: {
            value: { name: "dagshund.analytics.table_b" },
          },
        },
      },
    });

    const nodeIds = graph.nodes.map((n) => n.id);
    expect(nodeIds).toContain("resources.synced_database_tables.table_a");
    expect(nodeIds).toContain("resources.synced_database_tables.table_b");

    const edgePairs = graph.edges.map((e) => `${e.source}→${e.target}`);
    expect(edgePairs).toContain(
      "resources.schemas.analytics→resources.synced_database_tables.table_a",
    );
    expect(edgePairs).toContain(
      "resources.schemas.analytics→resources.synced_database_tables.table_b",
    );
  });
});

describe("effective-state relationship regressions", () => {
  test("does not restore an omitted top-level warehouse relationship from remote state", () => {
    const graph = buildResourceGraphFromPlan({
      plan: {
        "resources.quality_monitors.monitor": {
          action: "update",
          new_state: { value: {} },
          remote_state: { warehouse_id: "stale-warehouse" },
        },
      },
    });

    expect(graph.nodes.some((node) => node.id === "sql-warehouse::stale-warehouse")).toBe(false);
    expect(
      graph.lateralEdges.some((edge) => edge.target === "sql-warehouse::stale-warehouse"),
    ).toBe(false);
  });

  test("does not restore a remote synced-table output omitted from current state", () => {
    const graph = buildResourceGraphFromPlan({
      plan: {
        "resources.postgres_synced_tables.orders": {
          action: "update",
          new_state: { value: {} },
          remote_state: { synced_table_id: "catalog.schema.stale_orders" },
        },
      },
    });

    expect(
      graph.nodes.some((node) => node.id === "uc-synced-table::catalog.schema.stale_orders"),
    ).toBe(false);
    expect(
      graph.lateralEdges.some(
        (edge) => edge.target === "uc-synced-table::catalog.schema.stale_orders",
      ),
    ).toBe(false);
  });
});

describe("pipeline event-log derived UC tables", () => {
  test("does not restore a remote event-log output omitted from current state", () => {
    const graph = buildResourceGraphFromPlan({
      plan: {
        "resources.pipelines.ingest": {
          action: "update",
          new_state: { value: {} },
          remote_state: {
            event_log: { catalog: "dagshund", schema: "operations", name: "old_events" },
          },
        },
      },
    });

    expect(
      graph.nodes.some((node) => node.id === "pipeline-event-log::dagshund.operations.old_events"),
    ).toBe(false);
  });

  test("places the event log under its schema and promotes a table phantom", () => {
    const identity = "dagshund.operations.pipeline_events";
    const graph = buildResourceGraphFromPlan({
      plan: {
        "resources.pipelines.ingest": {
          action: "update",
          new_state: {
            value: {
              event_log: { catalog: "dagshund", schema: "operations", name: "pipeline_events" },
            },
          },
        },
        "resources.quality_monitors.event_monitor": {
          action: "create",
          new_state: { value: { table_name: identity } },
        },
      },
    });

    const derivedId = `pipeline-event-log::${identity}`;
    expect(graph.nodes).toContainEqual(
      expect.objectContaining({
        id: derivedId,
        nodeKind: "derived",
        derivedKind: "pipelineEventLog",
        ownerResourceKey: "resources.pipelines.ingest",
        diffState: "modified",
      }),
    );
    expect(graph.nodes.some((node) => node.id === `source-table::${identity}`)).toBe(false);
    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        source: "schema::dagshund.operations",
        target: derivedId,
      }),
    );
    expect(graph.lateralEdges).toContainEqual(
      expect.objectContaining({ source: derivedId, target: "resources.pipelines.ingest" }),
    );
    expect(graph.lateralEdges).toContainEqual(
      expect.objectContaining({
        source: "resources.quality_monitors.event_monitor",
        target: derivedId,
      }),
    );
  });
});

describe("postgres_synced_tables derived UC tables", () => {
  test("create produces an added derived output and unchanged source phantom", () => {
    const graph = buildResourceGraphFromPlan({
      plan: {
        "resources.postgres_synced_tables.phantom_table": {
          action: "create",
          new_state: {
            value: {
              branch: "projects/dagshund/branches/dev",
              postgres_database: "app_db",
              source_table_full_name: "dagshund.phantom_schema.phantom_table",
              synced_table_id: "dagshund_lakebase.public.phantom_table",
            },
          },
        },
      },
    });

    const source = graph.nodes.find(
      (node) => node.id === "source-table::dagshund.phantom_schema.phantom_table",
    );
    const derived = graph.nodes.find(
      (node) => node.id === "uc-synced-table::dagshund_lakebase.public.phantom_table",
    );
    if (derived?.nodeKind !== "derived") throw new Error("expected derived UC synced table");

    expect(source).toMatchObject({ nodeKind: "phantom", diffState: "unchanged" });
    expect(derived).toMatchObject({
      derivedKind: "ucSyncedTable",
      ownerResourceKey: "resources.postgres_synced_tables.phantom_table",
      diffState: "added",
      changes: undefined,
      resourceState: undefined,
      newState: undefined,
      remoteState: undefined,
    });

    const hierarchyEdge = graph.edges.find((edge) => edge.target === derived.id);
    expect(hierarchyEdge).toMatchObject({
      source: "schema::dagshund_lakebase.public",
      diffState: "added",
    });

    const lateralEdgePairs = graph.lateralEdges.map((edge) => `${edge.source}→${edge.target}`);
    expect(lateralEdgePairs).toContain(
      "resources.postgres_synced_tables.phantom_table→source-table::dagshund.phantom_schema.phantom_table",
    );
    expect(lateralEdgePairs).toContain(
      "uc-synced-table::dagshund_lakebase.public.phantom_table→resources.postgres_synced_tables.phantom_table",
    );
    expect(graph.lateralEdges.find((edge) => edge.source === derived.id)).toMatchObject({
      target: "resources.postgres_synced_tables.phantom_table",
      diffState: "unchanged",
    });
  });

  test("delete reads the derived output from remote state", () => {
    const graph = buildResourceGraphFromPlan({
      plan: {
        "resources.postgres_synced_tables.old_table": {
          action: "delete",
          remote_state: {
            branch: "projects/dagshund/branches/dev",
            postgres_database: "app_db",
            synced_table_id: "dagshund_lakebase.public.old_table",
          },
        },
      },
    });

    const derived = graph.nodes.find(
      (node) => node.id === "uc-synced-table::dagshund_lakebase.public.old_table",
    );
    expect(derived).toMatchObject({ nodeKind: "derived", diffState: "removed" });
    expect(graph.edges.find((edge) => edge.target === derived?.id)).toMatchObject({
      diffState: "removed",
    });
  });

  test("missing and malformed output identities produce no derived nodes or edges", () => {
    const graph = buildResourceGraphFromPlan({
      plan: {
        "resources.postgres_synced_tables.missing": {
          action: "create",
          new_state: { value: { source_table_full_name: "source.data.missing" } },
        },
        "resources.postgres_synced_tables.malformed": {
          action: "create",
          new_state: { value: { synced_table_id: "schema.table" } },
        },
      },
    });

    expect(
      graph.nodes.some(
        (node) => node.nodeKind === "derived" && node.derivedKind === "ucSyncedTable",
      ),
    ).toBe(false);
    expect(
      graph.nodes.filter(
        (node) => node.nodeKind === "derived" && node.derivedKind === "postgresSyncedTablePipeline",
      ),
    ).toHaveLength(2);
    expect(
      graph.lateralEdges.some(
        (edge) =>
          edge.source.startsWith("uc-synced-table::") ||
          edge.target.startsWith("uc-synced-table::"),
      ),
    ).toBe(false);
  });

  test("serving endpoint resolves a model by its registered-model resource key", () => {
    const graph = buildResourceGraphFromPlan({
      plan: {
        "resources.registered_models.model": {
          action: "create",
          new_state: { value: { name: "main.models.model" } },
        },
        "resources.model_serving_endpoints.endpoint": {
          action: "create",
          new_state: { value: { config: { served_entities: [{ entity_name: "model" }] } } },
        },
      },
    });

    expect(graph.lateralEdges).toContainEqual(
      expect.objectContaining({
        source: "resources.model_serving_endpoints.endpoint",
        target: "resources.registered_models.model",
      }),
    );
    expect(graph.nodes.some((node) => node.id === "registered-model::model")).toBe(false);
  });

  test("table references retarget to a promoted derived output", () => {
    const tableName = "shared.data.table";
    const graph = buildResourceGraphFromPlan({
      plan: {
        "resources.postgres_synced_tables.producer": {
          action: "create",
          new_state: { value: { synced_table_id: tableName } },
        },
        "resources.postgres_synced_tables.consumer": {
          action: "create",
          new_state: { value: { source_table_full_name: tableName } },
        },
        "resources.quality_monitors.monitor": {
          action: "create",
          new_state: { value: { table_name: tableName } },
        },
        "resources.apps.reader": {
          action: "create",
          new_state: {
            value: {
              resources: [{ name: "table", uc_securable: { securable_full_name: tableName } }],
            },
          },
        },
        "resources.model_serving_endpoints.model": {
          action: "create",
          new_state: {
            value: { config: { served_entities: [{ entity_name: tableName }] } },
          },
        },
      },
    });

    expect(graph.nodes.some((node) => node.id === `source-table::${tableName}`)).toBe(false);
    expect(graph.nodes.some((node) => node.id === `uc-synced-table::${tableName}`)).toBe(true);
    expect(graph.nodes.some((node) => node.id === `registered-model::${tableName}`)).toBe(true);

    const lateralEdgePairs = graph.lateralEdges.map((edge) => `${edge.source}→${edge.target}`);
    expect(lateralEdgePairs).toContain(
      `uc-synced-table::${tableName}→resources.postgres_synced_tables.producer`,
    );
    expect(lateralEdgePairs).toContain(
      `resources.postgres_synced_tables.consumer→uc-synced-table::${tableName}`,
    );
    expect(lateralEdgePairs).toContain(
      `resources.quality_monitors.monitor→uc-synced-table::${tableName}`,
    );
    expect(lateralEdgePairs).toContain(`resources.apps.reader→uc-synced-table::${tableName}`);
    expect(lateralEdgePairs).toContain(
      `resources.model_serving_endpoints.model→registered-model::${tableName}`,
    );
  });

  test("derived output wins when source and output identities match", () => {
    const graph = buildResourceGraphFromPlan({
      plan: {
        "resources.postgres_synced_tables.shared": {
          action: "create",
          new_state: {
            value: {
              source_table_full_name: "shared.data.table",
              synced_table_id: "shared.data.table",
            },
          },
        },
      },
    });

    expect(graph.nodes).toContainEqual(
      expect.objectContaining({
        id: "uc-synced-table::shared.data.table",
        nodeKind: "derived",
      }),
    );
    expect(graph.nodes.some((node) => node.id === "source-table::shared.data.table")).toBe(false);
    const relatedIds = new Set([
      "resources.postgres_synced_tables.shared",
      "uc-synced-table::shared.data.table",
    ]);
    expect(
      graph.lateralEdges.filter(
        (edge) => relatedIds.has(edge.source) && relatedIds.has(edge.target),
      ),
    ).toEqual([
      expect.objectContaining({
        source: "uc-synced-table::shared.data.table",
        target: "resources.postgres_synced_tables.shared",
      }),
    ]);
  });
});

describe("postgres_synced_tables derived pipelines", () => {
  test("falls back to a concrete status pipeline output when the direct value is unusable", () => {
    const graph = buildResourceGraphFromPlan({
      plan: {
        "resources.postgres_synced_tables.sync": {
          action: "create",
          new_state: { value: { pipeline_id: "", status: { pipeline_id: "concrete-output" } } },
        },
        "resources.jobs.consumer": {
          action: "create",
          new_state: {
            value: {
              tasks: [{ task_key: "refresh", pipeline_task: { pipeline_id: "concrete-output" } }],
            },
          },
        },
      },
    });

    expect(graph.lateralEdges).toContainEqual(
      expect.objectContaining({
        source: "resources.jobs.consumer",
        target: "postgres-synced-pipeline::concrete-output",
      }),
    );
    expect(graph.nodes.some((node) => node.id === "pipeline::concrete-output")).toBe(false);
  });

  test("keeps historical generated pipeline output identity when current output is omitted", () => {
    const graph = buildResourceGraphFromPlan({
      plan: {
        "resources.postgres_synced_tables.orders": {
          action: "update",
          new_state: { value: {} },
          remote_state: { pipeline_id: "historical-output-id" },
        },
      },
    });

    expect(
      graph.nodes.some((node) => node.id === "postgres-synced-pipeline::historical-output-id"),
    ).toBe(true);
  });

  test("first-deploy job reference resolves to the generated pipeline", () => {
    const pipelineReference =
      // biome-ignore lint/suspicious/noTemplateCurlyInString: Databricks interpolation syntax
      "${resources.postgres_synced_tables.orders.status.pipeline_id}";
    const graph = buildResourceGraphFromPlan({
      plan: {
        "resources.postgres_synced_tables.orders": {
          action: "create",
          new_state: {
            value: {
              branch: "projects/dagshund/branches/dev",
              postgres_database: "app_db",
              synced_table_id: "dagshund_lakebase.public.orders",
            },
          },
        },
        "resources.jobs.refresh_orders": {
          action: "create",
          new_state: {
            value: {
              tasks: [
                {
                  task_key: "refresh",
                  pipeline_task: { pipeline_id: pipelineReference },
                },
              ],
            },
          },
        },
      },
    });

    const generatedPipeline = graph.nodes.find(
      (node) => node.id === "postgres-synced-pipeline::resources.postgres_synced_tables.orders",
    );
    expect(generatedPipeline).toMatchObject({
      nodeKind: "derived",
      derivedKind: "postgresSyncedTablePipeline",
      label: "orders pipeline",
      ownerResourceKey: "resources.postgres_synced_tables.orders",
      diffState: "added",
    });
    expect(graph.nodes.some((node) => node.id === `pipeline::${pipelineReference}`)).toBe(false);
    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        source: "other-resources-root",
        target: generatedPipeline?.id,
        diffState: "added",
      }),
    );
    expect(graph.lateralEdges).toContainEqual(
      expect.objectContaining({
        source: "resources.jobs.refresh_orders",
        target: generatedPipeline?.id,
      }),
    );
    expect(graph.lateralEdges).toContainEqual(
      expect.objectContaining({
        source: generatedPipeline?.id,
        target: "resources.postgres_synced_tables.orders",
      }),
    );
  });

  test("symbolic and concrete pipeline aliases deduplicate to one generated pipeline edge", () => {
    const graph = buildResourceGraphFromPlan({
      plan: {
        "resources.postgres_synced_tables.orders": {
          action: "create",
          new_state: {
            value: {
              pipeline_id: "pipeline-orders",
              status: { pipeline_id: "pipeline-orders" },
            },
          },
        },
        "resources.jobs.refresh_orders": {
          action: "create",
          new_state: {
            value: {
              tasks: [
                {
                  task_key: "refresh_pipeline_id",
                  pipeline_task: {
                    // biome-ignore lint/suspicious/noTemplateCurlyInString: Databricks interpolation syntax
                    pipeline_id: "${resources.postgres_synced_tables.orders.pipeline_id}",
                  },
                },
                {
                  task_key: "refresh_status_pipeline_id",
                  pipeline_task: {
                    // biome-ignore lint/suspicious/noTemplateCurlyInString: Databricks interpolation syntax
                    pipeline_id: "${resources.postgres_synced_tables.orders.status.pipeline_id}",
                  },
                },
                {
                  task_key: "refresh_concrete_pipeline_id",
                  pipeline_task: { pipeline_id: "pipeline-orders" },
                },
              ],
            },
          },
        },
      },
    });

    const generatedPipeline = graph.nodes.find(
      (node) => node.id === "postgres-synced-pipeline::pipeline-orders",
    );
    expect(generatedPipeline).toMatchObject({
      nodeKind: "derived",
      derivedKind: "postgresSyncedTablePipeline",
      ownerResourceKey: "resources.postgres_synced_tables.orders",
    });
    expect(
      graph.lateralEdges
        .filter((edge) => edge.source === "resources.jobs.refresh_orders")
        .map(({ source, target }) => ({ source, target })),
    ).toEqual([
      {
        source: "resources.jobs.refresh_orders",
        target: "postgres-synced-pipeline::pipeline-orders",
      },
    ]);
  });

  test("repeated generated pipelines use the Pipelines workspace category", () => {
    const graph = buildResourceGraphFromPlan({
      plan: {
        "resources.postgres_synced_tables.orders": {
          action: "create",
          new_state: { value: {} },
        },
        "resources.postgres_synced_tables.customers": {
          action: "create",
          new_state: { value: {} },
        },
      },
    });

    expect(graph.nodes).toContainEqual(
      expect.objectContaining({ id: "workspace-category::pipelines", label: "Pipelines" }),
    );
    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        source: "workspace-category::pipelines",
        target: "postgres-synced-pipeline::resources.postgres_synced_tables.orders",
      }),
    );
    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        source: "workspace-category::pipelines",
        target: "postgres-synced-pipeline::resources.postgres_synced_tables.customers",
      }),
    );
  });

  test("delete uses the concrete pipeline ID from remote state", () => {
    const graph = buildResourceGraphFromPlan({
      plan: {
        "resources.postgres_synced_tables.orders": {
          action: "delete",
          remote_state: {
            branch: "projects/dagshund/branches/dev",
            postgres_database: "app_db",
            status: { pipeline_id: "pipeline-orders" },
          },
        },
      },
    });

    const generatedPipeline = graph.nodes.find(
      (node) => node.id === "postgres-synced-pipeline::pipeline-orders",
    );

    expect(generatedPipeline).toMatchObject({
      nodeKind: "derived",
      derivedKind: "postgresSyncedTablePipeline",
      label: "orders pipeline",
      diffState: "removed",
    });
    expect(graph.edges.find((edge) => edge.target === generatedPipeline?.id)).toMatchObject({
      diffState: "removed",
    });
  });
});

describe("existing pipelines referenced by synced tables", () => {
  test("renders an external existing pipeline as a dashed phantom", () => {
    const graph = buildResourceGraphFromPlan({
      plan: {
        "resources.postgres_synced_tables.orders": {
          action: "update",
          new_state: {
            value: {
              existing_pipeline_id: "external-pipeline",
              synced_table_id: "catalog.schema.orders",
            },
          },
        },
      },
    });

    expect(graph.nodes.some((node) => node.id.startsWith("postgres-synced-pipeline::"))).toBe(
      false,
    );
    expect(graph.nodes).toContainEqual(
      expect.objectContaining({
        id: "pipeline::external-pipeline",
        label: "external-pipeline",
        nodeKind: "phantom",
        resourceKey: "pipeline::external-pipeline",
      }),
    );
    expect(graph.lateralEdges).toContainEqual(
      expect.objectContaining({
        source: "resources.postgres_synced_tables.orders",
        target: "pipeline::external-pipeline",
        diffState: "unchanged",
      }),
    );
  });

  test("resolves symbolic and concrete existing pipeline references to a real node", () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: Databricks interpolation syntax
    const symbolicId = "${resources.pipelines.shared.id}";
    const graph = buildResourceGraphFromPlan({
      plan: {
        "resources.postgres_synced_tables.orders": {
          action: "update",
          new_state: { value: { existing_pipeline_id: symbolicId } },
        },
        "resources.synced_database_tables.customers": {
          action: "update",
          new_state: { value: { existing_pipeline_id: "pipeline-shared" } },
        },
        "resources.pipelines.shared": {
          action: "skip",
          remote_state: { pipeline_id: "pipeline-shared", name: "shared" },
        },
      },
    });

    expect(graph.nodes.some((node) => node.id === "pipeline::pipeline-shared")).toBe(false);
    expect(graph.lateralEdges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "resources.postgres_synced_tables.orders",
          target: "resources.pipelines.shared",
          diffState: "unchanged",
        }),
        expect.objectContaining({
          source: "resources.synced_database_tables.customers",
          target: "resources.pipelines.shared",
          diffState: "unchanged",
        }),
      ]),
    );
  });

  test("does not restore an existing pipeline reference omitted from new state", () => {
    const graph = buildResourceGraphFromPlan({
      plan: {
        "resources.synced_database_tables.orders": {
          action: "update",
          new_state: { value: { name: "catalog.schema.orders" } },
          remote_state: { spec: { existing_pipeline_id: "pipeline-shared" } },
        },
        "resources.pipelines.shared": {
          action: "skip",
          remote_state: { pipeline_id: "pipeline-shared", name: "shared" },
        },
      },
    });

    expect(
      graph.lateralEdges.some((edge) => edge.source === "resources.synced_database_tables.orders"),
    ).toBe(false);
    expect(graph.nodes.some((node) => node.id === "pipeline::pipeline-shared")).toBe(false);
  });

  test("uses one prepared existing-pipeline projection for ownership and references", () => {
    const parsed = parsePlanJson({
      plan: {
        "resources.postgres_synced_tables.orders": {
          action: "create",
          new_state: { value: { existing_pipeline_id: "raw-pipeline" } },
        },
      },
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("test plan must parse");
    const prepared = preparePlan(normalizePlan(parsed.data.plan ?? {}));
    const key = "resources.postgres_synced_tables.orders";
    const original = prepared.byResourceKey.get(key);
    expect(original).toBeDefined();
    if (original === undefined) throw new Error("prepared resource must exist");
    const graph = buildResourceGraph({
      ...prepared,
      byResourceKey: new Map([
        ...prepared.byResourceKey,
        [
          key,
          { ...original, existingPipelineId: { status: "supported", value: "prepared-pipeline" } },
        ],
      ]),
    });

    expect(graph.nodes.some((node) => node.id === "pipeline::raw-pipeline")).toBe(false);
    expect(graph.nodes.some((node) => node.id === "pipeline::prepared-pipeline")).toBe(true);
    expect(graph.nodes.some((node) => node.id.startsWith("postgres-synced-pipeline::"))).toBe(
      false,
    );
    expect(graph.lateralEdges).toContainEqual(
      expect.objectContaining({ source: key, target: "pipeline::prepared-pipeline" }),
    );
  });

  test("diagnoses malformed references for both synced-table families without exposing values", () => {
    const entries = {
      "resources.postgres_synced_tables.malformed": {
        action: "create" as const,
        new_state: {
          value: { existing_pipeline_id: 42, pipeline_id: "generated", private: "SECRET" },
        },
      },
      "resources.synced_database_tables.malformed": {
        action: "create" as const,
        new_state: { value: { spec: { existing_pipeline_id: false }, private: "SECRET" } },
      },
    };
    const original = structuredClone(entries);
    const parsed = parsePlanJson({ plan: entries });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("test plan must parse");
    const prepared = preparePlan(normalizePlan(parsed.data.plan ?? {}));
    const graph = buildResourceGraph(prepared);

    expect(entries).toEqual(original);
    expect(graph.nodes.some((node) => node.id.startsWith("postgres-synced-pipeline::"))).toBe(
      false,
    );
    expect(graph.nodes.some((node) => node.id === "pipeline::generated")).toBe(false);
    expect(graph.lateralEdges).toEqual([]);
    expect(prepared.diagnostics).toEqual([
      {
        resourceKey: "resources.postgres_synced_tables.malformed",
        capability: "existing-pipeline-reference",
        reason: "invalid-shape",
      },
      {
        resourceKey: "resources.synced_database_tables.malformed",
        capability: "existing-pipeline-reference",
        reason: "invalid-shape",
      },
    ]);
    expect(JSON.stringify(prepared.diagnostics)).not.toContain("SECRET");
  });

  test("treats empty existing pipeline IDs as absent", () => {
    const entries = {
      "resources.postgres_synced_tables.empty": {
        action: "create" as const,
        new_state: { value: { existing_pipeline_id: "  ", pipeline_id: "generated" } },
      },
    };
    const parsed = parsePlanJson({ plan: entries });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("test plan must parse");
    const prepared = preparePlan(normalizePlan(parsed.data.plan ?? {}));
    const graph = buildResourceGraph(prepared);

    expect(graph.nodes.some((node) => node.id === "pipeline::generated")).toBe(false);
    expect(graph.nodes.some((node) => node.id === "postgres-synced-pipeline::generated")).toBe(
      true,
    );
    expect(prepared.diagnostics).toEqual([]);
  });

  test("uses a remote nested existing pipeline reference for a deleted synced table", () => {
    const graph = buildResourceGraphFromPlan({
      plan: {
        "resources.synced_database_tables.deleted": {
          action: "delete",
          remote_state: {
            name: "catalog.schema.deleted",
            spec: { existing_pipeline_id: "external-pipeline" },
          },
        },
      },
    });

    expect(graph.lateralEdges).toContainEqual(
      expect.objectContaining({
        source: "resources.synced_database_tables.deleted",
        target: "pipeline::external-pipeline",
      }),
    );
  });
});

describe("database_instances as flat workspace resources", () => {
  test("database_instance appears under workspace-root", () => {
    const graph = buildResourceGraphFromPlan({
      plan: {
        "resources.database_instances.my_instance": {
          action: "create",
          new_state: { value: { name: "my_instance", capacity: "CU_2" } },
        },
      },
    });

    const nodeIds = graph.nodes.map((n) => n.id);
    expect(nodeIds).toContain("workspace-root");
    expect(nodeIds).toContain("resources.database_instances.my_instance");
    expect(nodeIds).not.toContain("lakebase-root");

    const edgePairs = graph.edges.map((e) => `${e.source}→${e.target}`);
    expect(edgePairs).toContain("workspace-root→resources.database_instances.my_instance");
  });
});

describe("database_catalogs in UC", () => {
  test("database_catalog stays in UC regardless of database_instance_name", () => {
    const graph = buildResourceGraphFromPlan({
      plan: {
        "resources.database_catalogs.lb_cat": {
          action: "create",
          new_state: { value: { name: "lb_cat", database_instance_name: "my_instance" } },
        },
        "resources.database_instances.my_instance": {
          action: "create",
          new_state: { value: { name: "my_instance", capacity: "CU_2" } },
        },
      },
    });

    const edgePairs = graph.edges.map((e) => `${e.source}→${e.target}`);
    // Catalog in UC
    expect(edgePairs).toContain("uc-root→catalog::lb_cat");
    // Instance is flat workspace resource (no cross-edge)
    expect(edgePairs).toContain("workspace-root→resources.database_instances.my_instance");

    const nodeIds = graph.nodes.map((n) => n.id);
    expect(nodeIds).not.toContain("lakebase-root");
  });

  test("database_catalog without database_instance_name stays in UC", () => {
    const graph = buildResourceGraphFromPlan({
      plan: {
        "resources.database_catalogs.plain_cat": {
          action: "create",
          new_state: { value: { name: "plain_cat" } },
        },
      },
    });

    const edgePairs = graph.edges.map((e) => `${e.source}→${e.target}`);
    expect(edgePairs).toContain("uc-root→catalog::plain_cat");

    const nodeIds = graph.nodes.map((n) => n.id);
    expect(nodeIds).not.toContain("lakebase-root");
  });

  test("UC-only database catalog materializes the workspace root for an absent instance", () => {
    const graph = buildResourceGraphFromPlan({
      plan: {
        "resources.database_catalogs.lb_cat": {
          action: "create",
          new_state: { value: { name: "lb_cat", database_instance_name: "my_instance" } },
        },
      },
    });

    const nodeIds = graph.nodes.map((node) => node.id);
    expect(nodeIds).toContain("workspace-root");
    expect(nodeIds).toContain("database-instance::my_instance");

    const edgePairs = graph.edges.map((edge) => `${edge.source}→${edge.target}`);
    expect(edgePairs).toContain("workspace-root→database-instance::my_instance");
  });

  test("database_catalog with schema nests schema under catalog", () => {
    const graph = buildResourceGraphFromPlan({
      plan: {
        "resources.database_catalogs.lb_cat": {
          action: "create",
          new_state: { value: { name: "lb_cat", database_instance_name: "my_instance" } },
        },
        "resources.schemas.lb_schema": {
          action: "create",
          new_state: { value: { catalog_name: "lb_cat", name: "lb_schema" } },
        },
      },
    });

    const edgePairs = graph.edges.map((e) => `${e.source}→${e.target}`);
    expect(edgePairs).toContain("uc-root→catalog::lb_cat");
    expect(edgePairs).toContain("catalog::lb_cat→resources.schemas.lb_schema");
  });
});

describe("postgres_catalogs in UC", () => {
  test("does not materialize a phantom when the referenced database is real", () => {
    const branchRef = "$" + "{resources.postgres_branches.dev_branch.id}";
    const graph = buildResourceGraphFromPlan({
      plan: {
        "resources.postgres_branches.dev_branch": {
          action: "create",
          new_state: { value: { branch_id: "dev", parent: "projects/dagshund" } },
        },
        "resources.postgres_databases.dev_database": {
          action: "create",
          new_state: {
            value: { postgres_database: "app_db", parent: branchRef },
          },
        },
        "resources.postgres_catalogs.dev_catalog": {
          action: "create",
          new_state: {
            value: { branch: branchRef, catalog_id: "app_db", postgres_database: "app_db" },
          },
        },
      },
    });

    const nodeIds = graph.nodes.map((node) => node.id);
    expect(nodeIds).toContain("resources.postgres_databases.dev_database");
    expect(nodeIds).not.toContain("postgres-database::dagshund/dev/app_db");
  });

  test("postgres catalog renders as UC catalog with lateral edge to database phantom", () => {
    const branchIdRef = "$" + "{resources.postgres_branches.dev_branch.id}";
    const graph = buildResourceGraphFromPlan({
      plan: {
        "resources.postgres_branches.dev_branch": {
          action: "create",
          new_state: { value: { branch_id: "dev", parent: "projects/dagshund" } },
        },
        "resources.postgres_catalogs.dev_catalog": {
          action: "create",
          new_state: {
            value: {
              branch: branchIdRef,
              catalog_id: "dagshund_lakebase",
              postgres_database: "dagshund_lakebase",
            },
          },
        },
      },
    });

    const nodeIds = graph.nodes.map((n) => n.id);
    expect(nodeIds).toContain("catalog::dagshund_lakebase");
    expect(nodeIds).toContain("postgres-database::dagshund/dev/dagshund_lakebase");
    expect(nodeIds).not.toContain("resources.postgres_catalogs.dev_catalog");

    const catalogNode = graph.nodes.find((n) => n.id === "catalog::dagshund_lakebase");
    expect(catalogNode?.label).toBe("dagshund_lakebase");

    const edgePairs = graph.edges.map((e) => `${e.source}→${e.target}`);
    expect(edgePairs).toContain("uc-root→catalog::dagshund_lakebase");
    expect(edgePairs).toContain(
      "resources.postgres_branches.dev_branch→postgres-database::dagshund/dev/dagshund_lakebase",
    );
    expect(edgePairs).not.toContain("workspace-root→resources.postgres_catalogs.dev_catalog");

    const lateralEdgePairs = graph.lateralEdges.map((e) => `${e.source}→${e.target}`);
    expect(lateralEdgePairs).toContain(
      "catalog::dagshund_lakebase→postgres-database::dagshund/dev/dagshund_lakebase",
    );
  });
});

describe("mixed plan with UC + workspace + postgres", () => {
  test("creates correct structure with synced tables in UC and instances in workspace", () => {
    const graph = buildResourceGraphFromPlan({
      plan: {
        // UC (including synced table)
        "resources.schemas.analytics": {
          action: "update",
          new_state: { value: { catalog_name: "dagshund", name: "analytics" } },
        },
        "resources.synced_database_tables.lb_table": {
          action: "create",
          new_state: { value: { name: "dagshund.analytics.lb_table" } },
        },
        // Workspace (flat — jobs + database_instances)
        "resources.jobs.etl_pipeline": { action: "create" },
        "resources.database_instances.lb_inst": {
          action: "create",
          new_state: { value: { name: "lb_inst", capacity: "CU_1" } },
        },
        // Postgres
        "resources.postgres_projects.pg_proj": {
          action: "create",
          new_state: { value: { project_id: "pg-proj" } },
        },
        "resources.postgres_branches.pg_branch": {
          action: "create",
          new_state: { value: { branch_id: "pg-branch", parent: "projects/pg-proj" } },
        },
      },
    });

    const nodeIds = graph.nodes.map((n) => n.id);
    // Roots
    expect(nodeIds).toContain("uc-root");
    expect(nodeIds).toContain("workspace-root");
    expect(nodeIds).toContain("postgres-root");
    expect(nodeIds).not.toContain("lakebase-root");

    // Container resource nodes
    expect(nodeIds).toContain("catalog::dagshund");
    expect(nodeIds).toContain("postgres-project::pg-proj");

    // Leaf/flat resource nodes
    expect(nodeIds).toContain("resources.schemas.analytics");
    expect(nodeIds).toContain("resources.synced_database_tables.lb_table");
    expect(nodeIds).toContain("resources.jobs.etl_pipeline");
    expect(nodeIds).toContain("resources.database_instances.lb_inst");
    expect(nodeIds).toContain("resources.postgres_branches.pg_branch");

    const edgePairs = graph.edges.map((e) => `${e.source}→${e.target}`);
    // UC: synced table under schema
    expect(edgePairs).toContain("uc-root→catalog::dagshund");
    expect(edgePairs).toContain("catalog::dagshund→resources.schemas.analytics");
    expect(edgePairs).toContain(
      "resources.schemas.analytics→resources.synced_database_tables.lb_table",
    );
    // Workspace: singleton resources share a fallback group alongside Lakebase
    expect(edgePairs).toContain("workspace-root→other-resources-root");
    expect(edgePairs).toContain("other-resources-root→resources.jobs.etl_pipeline");
    expect(edgePairs).toContain("other-resources-root→resources.database_instances.lb_inst");
    // Postgres hierarchy
    expect(edgePairs).toContain("workspace-root→postgres-root");
    expect(edgePairs).toContain("postgres-root→postgres-project::pg-proj");
    expect(edgePairs).toContain("postgres-project::pg-proj→resources.postgres_branches.pg_branch");
  });
});

describe("workspace resource type grouping", () => {
  test("keeps singleton types directly under workspace", () => {
    const graph = buildResourceGraphFromPlan({
      plan: {
        "resources.jobs.job_a": { action: "create" },
        "resources.alerts.alert_a": { action: "create" },
      },
    });

    const categoryNodes = graph.nodes.filter((node) => node.id.startsWith("workspace-category::"));
    const edgePairs = graph.edges.map((edge) => `${edge.source}→${edge.target}`);
    expect(categoryNodes).toHaveLength(0);
    expect(edgePairs).toContain("workspace-root→resources.jobs.job_a");
    expect(edgePairs).toContain("workspace-root→resources.alerts.alert_a");
  });

  test("creates a stable human-readable category for a repeated type", () => {
    const graph = buildResourceGraphFromPlan({
      plan: {
        "resources.custom_widgets.widget_a": { action: "create" },
        "resources.custom_widgets.widget_b": { action: "update" },
      },
    });

    const category = graph.nodes.find((node) => node.id === "workspace-category::custom_widgets");
    expect(category?.nodeKind).toBe("root");
    expect(category?.label).toBe("Custom Widgets");
    expect(graph.nodes.map((node) => node.id)).not.toContain("other-resources-root");

    const edgePairs = graph.edges.map((edge) => `${edge.source}→${edge.target}`);
    expect(edgePairs).toContain("workspace-root→workspace-category::custom_widgets");
    expect(edgePairs).toContain(
      "workspace-category::custom_widgets→resources.custom_widgets.widget_a",
    );
    expect(edgePairs).toContain(
      "workspace-category::custom_widgets→resources.custom_widgets.widget_b",
    );
  });

  test("creates separate categories for multiple repeated types", () => {
    const graph = buildResourceGraphFromPlan({
      plan: {
        "resources.jobs.job_a": { action: "create" },
        "resources.jobs.job_b": { action: "create" },
        "resources.apps.app_a": { action: "create" },
        "resources.apps.app_b": { action: "create" },
        "resources.pipelines.pipeline_a": { action: "create" },
      },
    });

    const nodeIds = graph.nodes.map((node) => node.id);
    expect(nodeIds).toContain("workspace-category::jobs");
    expect(nodeIds).toContain("workspace-category::apps");
    expect(nodeIds).not.toContain("workspace-category::pipelines");

    const edgePairs = graph.edges.map((edge) => `${edge.source}→${edge.target}`);
    expect(edgePairs).toContain("workspace-root→other-resources-root");
    expect(edgePairs).toContain("other-resources-root→resources.pipelines.pipeline_a");
    expect(edgePairs).toContain("workspace-category::jobs→resources.jobs.job_a");
    expect(edgePairs).toContain("workspace-category::apps→resources.apps.app_a");
  });

  test("places repeated categories alongside the Lakebase hierarchy", () => {
    const graph = buildResourceGraphFromPlan({
      plan: {
        "resources.jobs.job_a": { action: "create" },
        "resources.jobs.job_b": { action: "create" },
        "resources.postgres_projects.pg_proj": {
          action: "create",
          new_state: { value: { project_id: "pg-proj" } },
        },
      },
    });

    const edgePairs = graph.edges.map((edge) => `${edge.source}→${edge.target}`);
    expect(edgePairs).toContain("workspace-root→workspace-category::jobs");
    expect(edgePairs).toContain("workspace-root→postgres-root");
    expect(edgePairs).toContain("workspace-category::jobs→resources.jobs.job_a");
  });

  test("creates no categories when the workspace only contains Lakebase", () => {
    const graph = buildResourceGraphFromPlan({
      plan: {
        "resources.postgres_projects.pg_proj": {
          action: "create",
          new_state: { value: { project_id: "pg-proj" } },
        },
      },
    });

    const categoryNodes = graph.nodes.filter((node) => node.id.startsWith("workspace-category::"));
    const nodeIds = graph.nodes.map((node) => node.id);
    expect(categoryNodes).toHaveLength(0);
    expect(nodeIds).toContain("postgres-root");
    expect(nodeIds).not.toContain("other-resources-root");
  });

  test("does not count an external phantom toward the category threshold", () => {
    const graph = buildResourceGraphFromPlan({
      plan: {
        "resources.jobs.my_job": {
          action: "create",
          new_state: {
            value: {
              tasks: [{ task_key: "external", run_job_task: { job_id: 123 } }],
            },
          },
        },
      },
    });

    const nodeIds = graph.nodes.map((node) => node.id);
    expect(nodeIds).not.toContain("workspace-category::jobs");
    expect(nodeIds).toContain("job::123");

    const edgePairs = graph.edges.map((edge) => `${edge.source}→${edge.target}`);
    expect(edgePairs).toContain("workspace-root→resources.jobs.my_job");
    expect(edgePairs).toContain("workspace-root→job::123");
  });

  test("resolves run_job_task vars before creating a numeric phantom", () => {
    const graph = buildResourceGraphFromPlan({
      plan: {
        "resources.jobs.source": {
          action: "create",
          new_state: {
            value: { tasks: [{ task_key: "trigger", run_job_task: { job_id: 123 } }] },
            vars: { "tasks[0].run_job_task.job_id": "$" + "{resources.jobs.target.id}" },
          },
        },
        "resources.jobs.target": {
          action: "update",
          new_state: { value: { job_id: 456 } },
          remote_state: { job_id: 456 },
        },
      },
    });

    const nodeIds = graph.nodes.map((node) => node.id);
    const edgePairs = graph.lateralEdges.map((edge) => `${edge.source}→${edge.target}`);
    expect(nodeIds).not.toContain("job::123");
    expect(edgePairs).toContain("resources.jobs.source→resources.jobs.target");
  });

  test("places a phantom under an existing matching type category", () => {
    const graph = buildResourceGraphFromPlan({
      plan: {
        "resources.jobs.job_a": {
          action: "create",
          new_state: {
            value: {
              tasks: [{ task_key: "external", run_job_task: { job_id: 123 } }],
            },
          },
        },
        "resources.jobs.job_b": { action: "create" },
      },
    });

    const edgePairs = graph.edges.map((edge) => `${edge.source}→${edge.target}`);
    expect(edgePairs).toContain("workspace-category::jobs→job::123");
    expect(edgePairs).not.toContain("workspace-root→job::123");
  });

  test("places unmatched phantom types under Other Resources when a category exists", () => {
    const graph = buildResourceGraphFromPlan({
      plan: {
        "resources.jobs.job_a": { action: "create" },
        "resources.jobs.job_b": { action: "create" },
        "resources.alerts.data_freshness": {
          action: "create",
          new_state: { value: { warehouse_id: "external-warehouse" } },
        },
      },
    });

    const edgePairs = graph.edges.map((edge) => `${edge.source}→${edge.target}`);
    expect(edgePairs).toContain("workspace-root→other-resources-root");
    expect(edgePairs).toContain("other-resources-root→resources.alerts.data_freshness");
    expect(edgePairs).toContain("other-resources-root→sql-warehouse::external-warehouse");
  });
});

describe("phantom node deduplication", () => {
  test("Genie space warehouse references preserve real and missing targets", () => {
    const graph = buildResourceGraphFromPlan({
      plan: {
        "resources.sql_warehouses.real": {
          action: "create",
          new_state: { value: { id: "warehouse-real" } },
        },
        "resources.genie_spaces.using_real": {
          action: "create",
          new_state: { value: { warehouse_id: "warehouse-real" } },
        },
        "resources.genie_spaces.using_missing": {
          action: "create",
          new_state: { value: { warehouse_id: "warehouse-missing" } },
        },
      },
    });

    const nodeIds = graph.nodes.map((node) => node.id);
    const edgePairs = graph.lateralEdges.map((edge) => `${edge.source}→${edge.target}`);
    expect(nodeIds).toContain("resources.sql_warehouses.real");
    expect(nodeIds).toContain("sql-warehouse::warehouse-missing");
    expect(nodeIds.filter((id) => id === "sql-warehouse::warehouse-missing")).toHaveLength(1);
    expect(edgePairs).toContain("resources.genie_spaces.using_real→resources.sql_warehouses.real");
    expect(edgePairs).toContain(
      "resources.genie_spaces.using_missing→sql-warehouse::warehouse-missing",
    );
  });

  test("app and genie space sharing an external warehouse create one phantom node", () => {
    const graph = buildResourceGraphFromPlan({
      plan: {
        "resources.apps.taxi_app": {
          action: "create",
          new_state: {
            value: {
              resources: [
                {
                  name: "app_warehouse",
                  sql_warehouse: { id: "external-warehouse", permission: "CAN_USE" },
                },
              ],
            },
          },
        },
        "resources.genie_spaces.taxi_genie": {
          action: "create",
          new_state: {
            value: {
              title: "Taxi Genie",
              warehouse_id: "external-warehouse",
            },
          },
        },
      },
    });

    const warehouseNodes = graph.nodes.filter((n) => n.id === "sql-warehouse::external-warehouse");
    expect(warehouseNodes).toHaveLength(1);

    const lateralEdgePairs = graph.lateralEdges.map((e) => `${e.source}→${e.target}`);
    expect(lateralEdgePairs).toContain("resources.apps.taxi_app→sql-warehouse::external-warehouse");
    expect(lateralEdgePairs).toContain(
      "resources.genie_spaces.taxi_genie→sql-warehouse::external-warehouse",
    );
  });
});

describe("job task references with shared raw IDs", () => {
  test("parsed plan builds distinct real warehouse, dashboard and pipeline nodes and edges", () => {
    const parsed = parsePlanJson({
      plan: {
        "resources.jobs.shared_references": {
          action: "create",
          new_state: {
            value: {
              tasks: [
                {
                  task_key: "references",
                  sql_task: { warehouse_id: "shared" },
                  dashboard_task: { dashboard_id: "shared" },
                  pipeline_task: { pipeline_id: "shared" },
                },
              ],
            },
          },
        },
        "resources.sql_warehouses.shared": {
          action: "create",
          new_state: { value: { id: "shared", name: "Shared" } },
        },
        "resources.dashboards.shared": {
          action: "create",
          new_state: { value: { dashboard_id: "shared", display_name: "Shared" } },
        },
        "resources.pipelines.shared": {
          action: "create",
          new_state: { value: { pipeline_id: "shared", name: "Shared" } },
        },
      },
    });
    if (!parsed.ok) throw new Error(parsed.error);
    const graph = buildResourceGraphFromPlan(parsed.data);

    expect(graph.nodes.map((node) => node.id)).toEqual(
      expect.arrayContaining([
        "resources.sql_warehouses.shared",
        "resources.dashboards.shared",
        "resources.pipelines.shared",
      ]),
    );
    expect(
      graph.lateralEdges
        .filter((edge) => edge.source === "resources.jobs.shared_references")
        .map((edge) => `${edge.source}→${edge.target}`)
        .toSorted(),
    ).toEqual([
      "resources.jobs.shared_references→resources.dashboards.shared",
      "resources.jobs.shared_references→resources.pipelines.shared",
      "resources.jobs.shared_references→resources.sql_warehouses.shared",
    ]);
  });

  test("parsed plan builds all three phantom nodes and exact lateral edges", () => {
    const parsed = parsePlanJson({
      plan: {
        "resources.jobs.shared_references": {
          action: "create",
          new_state: {
            value: {
              tasks: [
                {
                  task_key: "references",
                  sql_task: { warehouse_id: "shared" },
                  dashboard_task: { dashboard_id: "shared" },
                  pipeline_task: { pipeline_id: "shared" },
                },
              ],
            },
          },
        },
      },
    });
    if (!parsed.ok) throw new Error(parsed.error);
    const graph = buildResourceGraphFromPlan(parsed.data);

    expect(graph.nodes.map((node) => node.id)).toEqual(
      expect.arrayContaining(["sql-warehouse::shared", "dashboard::shared", "pipeline::shared"]),
    );
    expect(
      graph.lateralEdges
        .filter((edge) => edge.source === "resources.jobs.shared_references")
        .map((edge) => `${edge.source}→${edge.target}`)
        .toSorted(),
    ).toEqual([
      "resources.jobs.shared_references→dashboard::shared",
      "resources.jobs.shared_references→pipeline::shared",
      "resources.jobs.shared_references→sql-warehouse::shared",
    ]);
    const nodeIds = new Set(graph.nodes.map((node) => node.id));
    expect(
      graph.lateralEdges.every((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target)),
    ).toBe(true);
  });
});

describe("parseThreePartName", () => {
  test("parses valid three-part name", () => {
    expect(parseThreePartName("catalog.schema.table")).toEqual({
      catalog: "catalog",
      schema: "schema",
      table: "table",
    });
  });

  test("returns undefined for two-part name", () => {
    expect(parseThreePartName("catalog.schema")).toBeUndefined();
  });

  test("returns undefined for simple name", () => {
    expect(parseThreePartName("simple")).toBeUndefined();
  });

  test("returns undefined for four-part name", () => {
    expect(parseThreePartName("a.b.c.d")).toBeUndefined();
  });
});

describe("source table phantom nodes", () => {
  test("source in existing real schema creates phantom leaf under real schema node", () => {
    const graph = buildResourceGraphFromPlan({
      plan: {
        "resources.schemas.analytics": {
          action: "update",
          new_state: { value: { catalog_name: "dagshund", name: "analytics" } },
        },
        "resources.synced_database_tables.my_table": {
          action: "create",
          new_state: {
            value: {
              name: "dagshund.analytics.my_table",
              spec: { source_table_full_name: "dagshund.analytics.source_data" },
            },
          },
        },
      },
    });

    const nodeIds = graph.nodes.map((n) => n.id);
    expect(nodeIds).toContain("source-table::dagshund.analytics.source_data");

    const phantom = graph.nodes.find(
      (n) => n.id === "source-table::dagshund.analytics.source_data",
    );
    expect(phantom?.nodeKind).toBe("phantom");
    expect(phantom?.label).toBe("source_data");

    const edgePairs = graph.edges.map((e) => `${e.source}→${e.target}`);
    expect(edgePairs).toContain(
      "resources.schemas.analytics→source-table::dagshund.analytics.source_data",
    );
  });

  test("source in non-existent schema creates phantom leaf + phantom schema + phantom catalog", () => {
    const graph = buildResourceGraphFromPlan({
      plan: {
        "resources.synced_database_tables.my_table": {
          action: "create",
          new_state: {
            value: {
              name: "prod.warehouse.my_table",
              spec: { source_table_full_name: "ext_catalog.ext_schema.ext_table" },
            },
          },
        },
      },
    });

    const nodeIds = graph.nodes.map((n) => n.id);
    expect(nodeIds).toContain("source-table::ext_catalog.ext_schema.ext_table");
    expect(nodeIds).toContain("schema::ext_catalog.ext_schema");
    expect(nodeIds).toContain("catalog::ext_catalog");

    const edgePairs = graph.edges.map((e) => `${e.source}→${e.target}`);
    expect(edgePairs).toContain("uc-root→catalog::ext_catalog");
    expect(edgePairs).toContain("catalog::ext_catalog→schema::ext_catalog.ext_schema");
    expect(edgePairs).toContain(
      "schema::ext_catalog.ext_schema→source-table::ext_catalog.ext_schema.ext_table",
    );
  });

  test("two synced tables sharing source schema create one phantom schema and two leaves", () => {
    const graph = buildResourceGraphFromPlan({
      plan: {
        "resources.synced_database_tables.table_a": {
          action: "create",
          new_state: {
            value: {
              name: "prod.data.table_a",
              spec: { source_table_full_name: "src.shared.alpha" },
            },
          },
        },
        "resources.synced_database_tables.table_b": {
          action: "create",
          new_state: {
            value: {
              name: "prod.data.table_b",
              spec: { source_table_full_name: "src.shared.beta" },
            },
          },
        },
      },
    });

    const nodeIds = graph.nodes.map((n) => n.id);
    expect(nodeIds).toContain("source-table::src.shared.alpha");
    expect(nodeIds).toContain("source-table::src.shared.beta");
    // Only one phantom schema for src.shared
    const schemaPhantoms = nodeIds.filter((id) => id === "schema::src.shared");
    expect(schemaPhantoms).toHaveLength(1);

    const edgePairs = graph.edges.map((e) => `${e.source}→${e.target}`);
    expect(edgePairs).toContain("schema::src.shared→source-table::src.shared.alpha");
    expect(edgePairs).toContain("schema::src.shared→source-table::src.shared.beta");
  });

  test("source matching real bundle synced table name creates no duplicate phantom", () => {
    const graph = buildResourceGraphFromPlan({
      plan: {
        "resources.synced_database_tables.existing": {
          action: "create",
          new_state: {
            value: {
              name: "cat.sch.existing_table",
              spec: { source_table_full_name: "cat.sch.existing_table" },
            },
          },
        },
      },
    });

    const sourceTableNodes = graph.nodes.filter((n) => n.id.startsWith("source-table::"));
    expect(sourceTableNodes).toHaveLength(0);
  });

  test("missing spec.source_table_full_name creates no phantom", () => {
    const graph = buildResourceGraphFromPlan({
      plan: {
        "resources.synced_database_tables.no_spec": {
          action: "create",
          new_state: {
            value: { name: "cat.sch.no_spec" },
          },
        },
      },
    });

    const sourceTableNodes = graph.nodes.filter((n) => n.id.startsWith("source-table::"));
    expect(sourceTableNodes).toHaveLength(0);
  });

  test("non-three-part source_table_full_name creates no phantom", () => {
    const graph = buildResourceGraphFromPlan({
      plan: {
        "resources.synced_database_tables.bad_ref": {
          action: "create",
          new_state: {
            value: {
              name: "cat.sch.bad_ref",
              spec: { source_table_full_name: "just_a_name" },
            },
          },
        },
      },
    });

    const sourceTableNodes = graph.nodes.filter((n) => n.id.startsWith("source-table::"));
    expect(sourceTableNodes).toHaveLength(0);
  });

  test("deleted entry with remote_state.spec creates phantom from source ref", () => {
    const graph = buildResourceGraphFromPlan({
      plan: {
        "resources.synced_database_tables.deleted_table": {
          action: "delete",
          remote_state: {
            name: "cat.sch.deleted_table",
            spec: { source_table_full_name: "origin.data.source_tbl" },
          },
        },
      },
    });

    const nodeIds = graph.nodes.map((n) => n.id);
    expect(nodeIds).toContain("source-table::origin.data.source_tbl");

    const phantom = graph.nodes.find((n) => n.id === "source-table::origin.data.source_tbl");
    expect(phantom?.nodeKind).toBe("phantom");
  });
});

describe("specialized real-reference resolution", () => {
  test("pipeline ingestion schema resolves to the real schema resource node", () => {
    const graph = buildResourceGraphFromPlan({
      plan: {
        "resources.schemas.analytics": {
          action: "create",
          new_state: { value: { catalog_name: "prod", name: "analytics" } },
        },
        "resources.pipelines.ingest": {
          action: "create",
          new_state: {
            value: {
              ingestion_definition: {
                objects: [{ schema: { source_catalog: "prod", source_schema: "analytics" } }],
              },
            },
          },
        },
      },
    });

    expect(graph.nodes.some((node) => node.id === "schema::prod.analytics")).toBe(false);
    expect(graph.lateralEdges).toContainEqual(
      expect.objectContaining({
        source: "resources.pipelines.ingest",
        target: "resources.schemas.analytics",
      }),
    );
  });

  test("component table identity resolves app, monitor and other-owner references to the real table", () => {
    const identity = "prod.analytics.orders";
    const graph = buildResourceGraphFromPlan({
      plan: {
        "resources.synced_database_tables.orders": {
          action: "create",
          new_state: {
            value: { name: "orders", catalog_name: "prod", schema_name: "analytics" },
          },
        },
        "resources.synced_database_tables.consumer": {
          action: "create",
          new_state: { value: { spec: { source_table_full_name: identity } } },
        },
        "resources.quality_monitors.orders": {
          action: "create",
          new_state: { value: { table_name: identity } },
        },
        "resources.apps.reader": {
          action: "create",
          new_state: {
            value: {
              resources: [{ name: "table", uc_securable: { securable_full_name: identity } }],
            },
          },
        },
      },
    });

    expect(graph.nodes.some((node) => node.id === `source-table::${identity}`)).toBe(false);
    for (const source of [
      "resources.synced_database_tables.consumer",
      "resources.quality_monitors.orders",
      "resources.apps.reader",
    ]) {
      expect(graph.lateralEdges).toContainEqual(
        expect.objectContaining({ source, target: "resources.synced_database_tables.orders" }),
      );
    }
  });

  test("quality-monitor and synced-table references resolve once to a real synced table", () => {
    const identity = "prod.analytics.orders";
    const graph = buildResourceGraphFromPlan({
      plan: {
        "resources.synced_database_tables.orders": {
          action: "create",
          new_state: { value: { name: identity, spec: { source_table_full_name: identity } } },
        },
        "resources.quality_monitors.orders": {
          action: "create",
          new_state: { value: { table_name: identity } },
        },
      },
    });

    expect(graph.nodes.some((node) => node.id === `source-table::${identity}`)).toBe(false);
    expect(graph.lateralEdges).toContainEqual(
      expect.objectContaining({
        source: "resources.quality_monitors.orders",
        target: "resources.synced_database_tables.orders",
      }),
    );
  });
});

describe("schema-supported workspace resource relationships", () => {
  test("builds instance pool and Vector Search endpoint lateral edges without fixtures", () => {
    const poolRef = "$" + "{resources.instance_pools.workers.id}";
    const endpointRef = "$" + "{resources.vector_search_endpoints.search.name}";
    const graph = buildResourceGraphFromPlan({
      plan: {
        "resources.clusters.interactive": {
          action: "create",
          new_state: { value: { instance_pool_id: poolRef } },
        },
        "resources.instance_pools.workers": {
          action: "create",
          new_state: { value: { instance_pool_name: "workers" } },
        },
        "resources.vector_search_indexes.docs": {
          action: "create",
          new_state: { value: { endpoint_name: endpointRef } },
        },
        "resources.vector_search_endpoints.search": {
          action: "create",
          new_state: { value: { name: "edge-search" } },
        },
      },
    });

    const lateralEdgePairs = graph.lateralEdges.map((edge) => `${edge.source}→${edge.target}`);
    expect(lateralEdgePairs).toContain(
      "resources.clusters.interactive→resources.instance_pools.workers",
    );
    expect(lateralEdgePairs).toContain(
      "resources.vector_search_indexes.docs→resources.vector_search_endpoints.search",
    );
  });

  test("builds a nested for-each task instance pool lateral edge", () => {
    const poolRef = "$" + "{resources.instance_pools.workers.id}";
    const graph = buildResourceGraphFromPlan({
      plan: {
        "resources.jobs.foreach": {
          action: "create",
          new_state: {
            value: {
              tasks: [
                {
                  task_key: "loop",
                  for_each_task: {
                    task: {
                      new_cluster: { instance_pool_id: poolRef },
                    },
                  },
                },
              ],
            },
          },
        },
        "resources.instance_pools.workers": {
          action: "create",
          new_state: { value: { instance_pool_name: "workers" } },
        },
      },
    });

    expect(graph.lateralEdges.map((edge) => `${edge.source}→${edge.target}`)).toContain(
      "resources.jobs.foreach→resources.instance_pools.workers",
    );
  });
});

describe("external leaf phantom refs (UC hierarchy placement)", () => {
  test("app uc_securable phantom is placed under correct catalog and schema", () => {
    const graph = buildResourceGraphFromPlan({
      plan: {
        "resources.apps.my_app": {
          action: "update",
          new_state: {
            value: {
              resources: [
                { name: "tbl", uc_securable: { securable_full_name: "prod.analytics.users" } },
              ],
            },
          },
        },
      },
    });

    const nodeIds = graph.nodes.map((n) => n.id);
    expect(nodeIds).toContain("source-table::prod.analytics.users");
    expect(nodeIds).toContain("schema::prod.analytics");
    expect(nodeIds).toContain("catalog::prod");

    const phantom = graph.nodes.find((n) => n.id === "source-table::prod.analytics.users");
    expect(phantom?.nodeKind).toBe("phantom");
    expect(phantom?.label).toBe("users");

    const edgePairs = graph.edges.map((e) => `${e.source}→${e.target}`);
    expect(edgePairs).toContain("uc-root→catalog::prod");
    expect(edgePairs).toContain("catalog::prod→schema::prod.analytics");
    expect(edgePairs).toContain("schema::prod.analytics→source-table::prod.analytics.users");
  });

  test("serving endpoint registered model phantom is placed in UC hierarchy", () => {
    const graph = buildResourceGraphFromPlan({
      plan: {
        "resources.model_serving_endpoints.my_endpoint": {
          action: "update",
          new_state: {
            value: {
              config: {
                served_entities: [{ entity_name: "ml.models.recommender", entity_version: "1" }],
              },
            },
          },
        },
      },
    });

    const nodeIds = graph.nodes.map((n) => n.id);
    expect(nodeIds).toContain("registered-model::ml.models.recommender");
    expect(nodeIds).toContain("schema::ml.models");
    expect(nodeIds).toContain("catalog::ml");

    const edgePairs = graph.edges.map((e) => `${e.source}→${e.target}`);
    expect(edgePairs).toContain("schema::ml.models→registered-model::ml.models.recommender");
  });

  test("unsupported prepared source-table reference does not create hierarchy phantoms", () => {
    const graph = buildResourceGraphFromPlan({
      plan: {
        "resources.synced_database_tables.owner": {
          action: "create",
          new_state: {
            value: {
              source_table_full_name: 42,
              spec: { source_table_full_name: "source.raw.orders" },
            },
          },
        },
      },
    });

    expect(graph.nodes.map((node) => node.id)).toContain("resources.synced_database_tables.owner");
    expect(graph.nodes.some((node) => node.id === "source-table::source.raw.orders")).toBe(false);
    expect(graph.nodes.some((node) => node.id === "schema::source.raw")).toBe(false);
  });

  test("quality monitor table_name phantom is placed in UC hierarchy", () => {
    const graph = buildResourceGraphFromPlan({
      plan: {
        "resources.quality_monitors.mon": {
          action: "create",
          new_state: {
            value: { table_name: "analytics.staging.orders", warehouse_id: "abc123" },
          },
        },
      },
    });

    const nodeIds = graph.nodes.map((n) => n.id);
    expect(nodeIds).toContain("source-table::analytics.staging.orders");
    expect(nodeIds).toContain("schema::analytics.staging");
    expect(nodeIds).toContain("catalog::analytics");

    const edgePairs = graph.edges.map((e) => `${e.source}→${e.target}`);
    expect(edgePairs).toContain("schema::analytics.staging→source-table::analytics.staging.orders");
  });
});

describe("sub-resources-plan.json (sub-resource merging)", () => {
  test("merges sub-resource keys into parent resource node", async () => {
    const plan = await loadFixture("sub-resources");
    const graph = buildResourceGraphFromPlan(plan);

    const nodeIds = graph.nodes.map((n) => n.id);
    expect(nodeIds).toContain("resources.jobs.job_perm_change");
    expect(nodeIds).not.toContain("resources.jobs.job_perm_change.permissions");
    expect(nodeIds).not.toContain("resources.schemas.schema_perm_change.grants");
  });

  test("includes non-sub-resource entries", async () => {
    const plan = await loadFixture("sub-resources");
    const graph = buildResourceGraphFromPlan(plan);

    const resourceKeys = graph.nodes
      .filter((n): n is ResourceGraphNode => n.nodeKind === "resource")
      .map((n) => n.resourceKey);
    expect(resourceKeys).toContain("resources.jobs.job_perm_change");
    expect(resourceKeys).toContain("resources.schemas.schema_perm_change");
  });

  test("no edges reference sub-resource keys", async () => {
    const plan = await loadFixture("sub-resources");
    const graph = buildResourceGraphFromPlan(plan);

    for (const edge of [...graph.edges, ...graph.lateralEdges]) {
      expect(edge.source).not.toContain(".permissions");
      expect(edge.source).not.toContain(".grants");
      expect(edge.target).not.toContain(".permissions");
      expect(edge.target).not.toContain(".grants");
    }
  });

  test("parent node has merged permission state from remote_state", async () => {
    const plan = await loadFixture("sub-resources");
    const graph = buildResourceGraphFromPlan(plan);

    const jobNode = graph.nodes.find(
      (n): n is ResourceGraphNode =>
        n.nodeKind === "resource" && n.resourceKey === "resources.jobs.job_perm_change",
    );
    expect(jobNode).toBeDefined();
    const state = jobNode?.resourceState as Record<string, unknown> | undefined;
    expect(state?.["permissions"]).toBeObject();
    expect(state?.["permissions"]).toHaveProperty("object_id");
    expect(state?.["permissions"]).toHaveProperty("__embed__");
  });

  test("schema node has merged grants changes", async () => {
    const plan = await loadFixture("sub-resources");
    const graph = buildResourceGraphFromPlan(plan);

    const schemaNode = graph.nodes.find(
      (n): n is ResourceGraphNode =>
        n.nodeKind === "resource" && n.resourceKey === "resources.schemas.schema_perm_change",
    );
    expect(schemaNode).toBeDefined();
    const grantsChange = schemaNode?.changes?.["grants.[principal='data_engineers'].privileges"];
    expect(grantsChange).toHaveProperty("action", "update");
    expect(grantsChange).toHaveProperty("new");
    expect(grantsChange).toHaveProperty("old");
  });
});

describe("buildResourceGraph ctx-aware drift detection (dagshund-15yh)", () => {
  // Mirrors the synthetic plan in build-plan-graph.test.ts but exercises the
  // resource-graph entry point. The job's `taskChangeSummary[publish].isDrift`
  // is the load-bearing assertion: it proves `buildJobFields` correctly threads
  // `driftParent` through `buildTaskChangeSummary` even when the consumer is
  // `buildResourceGraph` (not `buildPlanGraph`). Without ctx threading, the
  // chip on the job-detail panel's task summary would render `isDrift: false`
  // for `publish` while the detail panel renders the drift pill on the field.
  const plan = {
    plan: {
      "resources.jobs.drift_pipeline": {
        action: "update" as const,
        new_state: {
          value: {
            edit_mode: "UI_LOCKED",
            tasks: [{ task_key: "publish", depends_on: [] }],
          },
        },
        remote_state: {
          edit_mode: "EDITABLE",
          tasks: [{ task_key: "publish", depends_on: [{ task_key: "ingest" }] }],
        },
        changes: {
          edit_mode: {
            action: "update" as const,
            old: "UI_LOCKED",
            new: "UI_LOCKED",
            remote: "EDITABLE",
          },
          "tasks[task_key='publish'].depends_on[task_key='ingest']": {
            action: "update" as const,
            remote: { task_key: "ingest" },
          },
        },
      },
    },
  };

  test("taskChangeSummary entry for publish has isDrift=true", () => {
    const graph = buildResourceGraphFromPlan(plan);
    const job = graph.nodes.find(
      (n): n is ResourceGraphNode =>
        n.nodeKind === "resource" && n.resourceKey === "resources.jobs.drift_pipeline",
    );
    const publishSummary = job?.taskChangeSummary?.find((e) => e.taskKey === "publish");
    expect(publishSummary?.isDrift).toBe(true);
  });
});
