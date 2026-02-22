import { describe, expect, test } from "bun:test";
import {
  buildResourceGraph,
  extractResourceType,
  extractStateField,
  isJobEntry,
  isLakebaseType,
  isPostgresType,
  isUnityCatalogType,
} from "../../src/graph/build-resource-graph.ts";
import type { ResourceGraphNode, ResourceGroupGraphNode } from "../../src/types/graph-types.ts";
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
    expect(isUnityCatalogType("catalogs")).toBe(true);
    expect(isUnityCatalogType("database_catalogs")).toBe(true);
  });

  test("returns false for non-UC types", () => {
    expect(isUnityCatalogType("dashboards")).toBe(false);
    expect(isUnityCatalogType("apps")).toBe(false);
    expect(isUnityCatalogType("jobs")).toBe(false);
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

describe("buildResourceGraph", () => {
  test("returns empty graph for empty plan", () => {
    const graph = buildResourceGraph({});
    expect(graph.nodes).toHaveLength(0);
    expect(graph.edges).toHaveLength(0);
  });

  test("includes jobs as workspace resource nodes", () => {
    const graph = buildResourceGraph({
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
    const graph = buildResourceGraph({
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
    const graph = buildResourceGraph({
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
    const graph = buildResourceGraph({
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

  test("creates phantom schema node when schema not in plan", () => {
    const graph = buildResourceGraph({
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
    const phantom = graph.nodes.find((n) => n.id === "external::dagshund.missing");
    expect(phantom).toBeDefined();
    expect(phantom?.nodeKind).toBe("resource-group");
    // Narrow the GraphNode union: find() returns the base union; .external lives on ResourceGroupGraphNode.
    expect((phantom as ResourceGroupGraphNode | undefined)?.external).toBe(true);
    expect(phantom?.label).toBe("missing");

    // Edge chain: catalog → phantom → volume
    const edgePairs = graph.edges.map((e) => `${e.source}→${e.target}`);
    expect(edgePairs).toContain("catalog::dagshund→external::dagshund.missing");
    expect(edgePairs).toContain("external::dagshund.missing→resources.volumes.orphan_vol");
  });

  test("falls back to catalog when both schema and catalog are missing", () => {
    const graph = buildResourceGraph({
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
    const phantoms = graph.nodes.filter((n) => n.id.startsWith("external::"));
    expect(phantoms).toHaveLength(0);
  });

  test("deduplicates phantom schema nodes for multiple resources", () => {
    const graph = buildResourceGraph({
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
    const phantoms = graph.nodes.filter((n) => n.id === "external::dagshund.ext_schema");
    expect(phantoms).toHaveLength(1);

    // Both volumes link through the phantom
    const edgePairs = graph.edges.map((e) => `${e.source}→${e.target}`);
    expect(edgePairs).toContain("external::dagshund.ext_schema→resources.volumes.vol_a");
    expect(edgePairs).toContain("external::dagshund.ext_schema→resources.volumes.vol_b");
  });

  test("real group nodes have external: false", () => {
    const graph = buildResourceGraph({
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
    expect((ucRoot as ResourceGroupGraphNode | undefined)?.external).toBe(false);
    const catalog = graph.nodes.find((n) => n.id === "catalog::dagshund");
    expect((catalog as ResourceGroupGraphNode | undefined)?.external).toBe(false);
  });

  test("catalog group node is phantom when catalog is not a plan entry", () => {
    const graph = buildResourceGraph({
      plan: {
        "resources.schemas.analytics": {
          action: "update",
          new_state: { value: { catalog_name: "dagshund", name: "analytics" } },
        },
      },
    });

    const catalog = graph.nodes.find((n) => n.id === "catalog::dagshund");
    expect((catalog as ResourceGroupGraphNode | undefined)?.external).toBe(true);
  });

  test("resource nodes have nodeKind 'resource' (no external field)", () => {
    const graph = buildResourceGraph({
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
    const graph = buildResourceGraph({
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
    const graph = buildResourceGraph({
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
    expect(ucRoot?.nodeKind).toBe("resource-group");
  });

  test("does not create workspace root when all resources are UC", () => {
    const graph = buildResourceGraph({
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

  describe("complex-plan.json fixture", () => {
    test("creates nodes for all 9 resources including jobs", async () => {
      const plan = await loadFixture("complex-plan.json");
      const graph = buildResourceGraph(plan);

      const resourceNodes = graph.nodes.filter((n) => n.nodeKind === "resource");
      expect(resourceNodes).toHaveLength(9);

      const resourceIds = resourceNodes.map((n) => n.id);
      expect(resourceIds).toContain("resources.schemas.analytics");
      expect(resourceIds).toContain("resources.schemas.analytics_staging");
      expect(resourceIds).toContain("resources.volumes.raw_data");
      expect(resourceIds).toContain("resources.volumes.external_imports");
      expect(resourceIds).toContain("resources.registered_models.quality_metrics");
      expect(resourceIds).toContain("resources.alerts.stale_pipeline_alert");
      expect(resourceIds).toContain("resources.experiments.audit_analysis");
      expect(resourceIds).toContain("resources.jobs.data_quality_pipeline");
      expect(resourceIds).toContain("resources.jobs.etl_pipeline");
    });

    test("creates UC root, catalog, and workspace group nodes", async () => {
      const plan = await loadFixture("complex-plan.json");
      const graph = buildResourceGraph(plan);

      const groupNodes = graph.nodes.filter((n) => n.nodeKind === "resource-group");
      const groupIds = groupNodes.map((n) => n.id);
      expect(groupIds).toContain("uc-root");
      expect(groupIds).toContain("catalog::dagshund");
      expect(groupIds).toContain("workspace-root");
    });

    test("deleted model has removed diff state", async () => {
      const plan = await loadFixture("complex-plan.json");
      const graph = buildResourceGraph(plan);

      const modelNode = graph.nodes.find(
        (n) => n.id === "resources.registered_models.quality_metrics",
      );
      expect(modelNode?.diffState).toBe("removed");
    });

    test("volume is linked to analytics schema", async () => {
      const plan = await loadFixture("complex-plan.json");
      const graph = buildResourceGraph(plan);

      const edgePairs = graph.edges.map((e) => `${e.source}→${e.target}`);
      expect(edgePairs).toContain("resources.schemas.analytics→resources.volumes.raw_data");
    });

    test("workspace resources including jobs are linked to workspace root", async () => {
      const plan = await loadFixture("complex-plan.json");
      const graph = buildResourceGraph(plan);

      const edgePairs = graph.edges.map((e) => `${e.source}→${e.target}`);
      expect(edgePairs).toContain("workspace-root→resources.alerts.stale_pipeline_alert");
      expect(edgePairs).toContain("workspace-root→resources.experiments.audit_analysis");
      expect(edgePairs).toContain("workspace-root→resources.jobs.data_quality_pipeline");
      expect(edgePairs).toContain("workspace-root→resources.jobs.etl_pipeline");
    });

    test("external_imports volume links through phantom schema node", async () => {
      const plan = await loadFixture("complex-plan.json");
      const graph = buildResourceGraph(plan);

      // Phantom schema node should exist for dagshund_no_dabs
      const phantom = graph.nodes.find((n) => n.id === "external::dagshund.dagshund_no_dabs");
      expect(phantom).toBeDefined();
      expect((phantom as ResourceGroupGraphNode | undefined)?.external).toBe(true);
      expect(phantom?.label).toBe("dagshund_no_dabs");
      expect(phantom?.nodeKind).toBe("resource-group");

      // Edge chain: catalog → phantom → volume
      const edgePairs = graph.edges.map((e) => `${e.source}→${e.target}`);
      expect(edgePairs).toContain("catalog::dagshund→external::dagshund.dagshund_no_dabs");
      expect(edgePairs).toContain(
        "external::dagshund.dagshund_no_dabs→resources.volumes.external_imports",
      );
    });
  });

  test("database_catalogs entry with child schema creates real catalog group node", () => {
    const graph = buildResourceGraph({
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

    const catalog = graph.nodes.find((n) => n.id === "catalog::lakebase_cat");
    expect(catalog).toBeDefined();
    expect((catalog as ResourceGroupGraphNode | undefined)?.external).toBe(false);

    const edgePairs = graph.edges.map((e) => `${e.source}→${e.target}`);
    expect(edgePairs).toContain("uc-root→catalog::lakebase_cat");
    // database_catalogs has no catalog_name — it IS a catalog, so links to uc-root
    expect(edgePairs).toContain("uc-root→resources.database_catalogs.lakebase_cat");
    expect(edgePairs).toContain("catalog::lakebase_cat→resources.schemas.lb_schema");
  });

  test("standalone database_catalogs entry appears under uc-root", () => {
    const graph = buildResourceGraph({
      plan: {
        "resources.database_catalogs.standalone": {
          action: "create",
          new_state: { value: { name: "standalone" } },
        },
      },
    });

    const nodeIds = graph.nodes.map((n) => n.id);
    expect(nodeIds).toContain("uc-root");
    expect(nodeIds).toContain("resources.database_catalogs.standalone");

    // No catalog group node since no child references catalog_name
    const groupNodes = graph.nodes.filter((n) => n.nodeKind === "resource-group");
    expect(groupNodes).toHaveLength(1); // only uc-root
  });

  test("job depends_on cross-type edges appear in resource graph", () => {
    const graph = buildResourceGraph({
      plan: {
        "resources.schemas.analytics": {
          action: "update",
          new_state: { value: { catalog_name: "dagshund", name: "analytics" } },
        },
        "resources.jobs.etl_pipeline": {
          action: "create",
          depends_on: [{ node: "resources.schemas.analytics" }],
        },
      },
    });

    const edgePairs = graph.edges.map((e) => `${e.source}→${e.target}`);
    expect(edgePairs).toContain("resources.schemas.analytics→resources.jobs.etl_pipeline");
  });

  test("job-to-job depends_on edges are excluded from resource graph", () => {
    const graph = buildResourceGraph({
      plan: {
        "resources.jobs.job_a": { action: "create" },
        "resources.jobs.job_b": {
          action: "create",
          depends_on: [{ node: "resources.jobs.job_a" }],
        },
      },
    });

    const edgePairs = graph.edges.map((e) => `${e.source}→${e.target}`);
    expect(edgePairs).not.toContain("resources.jobs.job_a→resources.jobs.job_b");
    // Both still link to workspace root
    expect(edgePairs).toContain("workspace-root→resources.jobs.job_a");
    expect(edgePairs).toContain("workspace-root→resources.jobs.job_b");
  });

  describe("job resource node filtering", () => {
    test("job resource node has taskChangeSummary when tasks have changes", () => {
      const graph = buildResourceGraph({
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
      const graph = buildResourceGraph({
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
      const graph = buildResourceGraph({
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
      const graph = buildResourceGraph({
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
      const graph = buildResourceGraph({
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
      const graph = buildResourceGraph({
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
      const graph = buildResourceGraph({
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
      const graph = buildResourceGraph({
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
    expect(isPostgresType("postgres_endpoints")).toBe(true);
  });

  test("returns false for non-postgres types", () => {
    expect(isPostgresType("jobs")).toBe(false);
    expect(isPostgresType("database_instances")).toBe(false);
    expect(isPostgresType("schemas")).toBe(false);
  });
});

describe("isLakebaseType", () => {
  test("returns true for lakebase types", () => {
    expect(isLakebaseType("database_instances")).toBe(true);
    expect(isLakebaseType("synced_database_tables")).toBe(true);
  });

  test("returns false for database_catalogs (stays in UC)", () => {
    expect(isLakebaseType("database_catalogs")).toBe(false);
  });

  test("returns false for non-lakebase types", () => {
    expect(isLakebaseType("jobs")).toBe(false);
    expect(isLakebaseType("postgres_projects")).toBe(false);
    expect(isLakebaseType("schemas")).toBe(false);
  });
});

describe("postgres hierarchy", () => {
  test("full chain: workspace-root → postgres-root → project group → branch → endpoint", () => {
    const graph = buildResourceGraph({
      plan: {
        "resources.postgres_projects.my_project": {
          action: "create",
          new_state: { value: { name: "my_project" } },
        },
        "resources.postgres_branches.my_branch": {
          action: "create",
          new_state: { value: { name: "my_branch", parent: "my_project" } },
        },
        "resources.postgres_endpoints.my_endpoint": {
          action: "create",
          new_state: { value: { name: "my_endpoint", parent: "my_branch" } },
        },
      },
    });

    const nodeIds = graph.nodes.map((n) => n.id);
    expect(nodeIds).toContain("workspace-root");
    expect(nodeIds).toContain("postgres-root");
    expect(nodeIds).toContain("postgres-project::my_project");
    expect(nodeIds).toContain("resources.postgres_branches.my_branch");
    expect(nodeIds).toContain("resources.postgres_endpoints.my_endpoint");

    const edgePairs = graph.edges.map((e) => `${e.source}→${e.target}`);
    expect(edgePairs).toContain("workspace-root→postgres-root");
    expect(edgePairs).toContain("postgres-root→postgres-project::my_project");
    expect(edgePairs).toContain(
      "postgres-project::my_project→resources.postgres_branches.my_branch",
    );
    expect(edgePairs).toContain(
      "resources.postgres_branches.my_branch→resources.postgres_endpoints.my_endpoint",
    );

    // Narrow: .external lives on ResourceGroupGraphNode, not the base union
    const projectGroup = graph.nodes.find((n) => n.id === "postgres-project::my_project");
    expect((projectGroup as ResourceGroupGraphNode | undefined)?.external).toBe(false);
  });

  test("phantom branch when branch not in plan hangs off postgres-root", () => {
    const graph = buildResourceGraph({
      plan: {
        "resources.postgres_endpoints.my_endpoint": {
          action: "create",
          new_state: { value: { name: "my_endpoint", parent: "missing_branch" } },
        },
      },
    });

    const nodeIds = graph.nodes.map((n) => n.id);
    expect(nodeIds).toContain("external::postgres-branch::missing_branch");

    const phantom = graph.nodes.find((n) => n.id === "external::postgres-branch::missing_branch");
    expect((phantom as ResourceGroupGraphNode | undefined)?.external).toBe(true);

    const edgePairs = graph.edges.map((e) => `${e.source}→${e.target}`);
    expect(edgePairs).toContain("postgres-root→external::postgres-branch::missing_branch");
    expect(edgePairs).toContain(
      "external::postgres-branch::missing_branch→resources.postgres_endpoints.my_endpoint",
    );
  });

  test("project group is external when no project entry exists", () => {
    const graph = buildResourceGraph({
      plan: {
        "resources.postgres_branches.my_branch": {
          action: "create",
          new_state: { value: { name: "my_branch", parent: "ext_project" } },
        },
      },
    });

    const projectGroup = graph.nodes.find((n) => n.id === "postgres-project::ext_project");
    expect(projectGroup).toBeDefined();
    expect((projectGroup as ResourceGroupGraphNode | undefined)?.external).toBe(true);
  });

  test("endpoint with no parent field falls back to postgres-root", () => {
    const graph = buildResourceGraph({
      plan: {
        "resources.postgres_endpoints.orphan": {
          action: "create",
          new_state: { value: { name: "orphan" } },
        },
      },
    });

    const edgePairs = graph.edges.map((e) => `${e.source}→${e.target}`);
    expect(edgePairs).toContain("postgres-root→resources.postgres_endpoints.orphan");
  });

  test("standalone project appears under postgres-root", () => {
    const graph = buildResourceGraph({
      plan: {
        "resources.postgres_projects.solo": {
          action: "create",
          new_state: { value: { name: "solo" } },
        },
      },
    });

    const nodeIds = graph.nodes.map((n) => n.id);
    expect(nodeIds).toContain("workspace-root");
    expect(nodeIds).toContain("postgres-root");
    expect(nodeIds).toContain("postgres-project::solo");
    expect(nodeIds).toContain("resources.postgres_projects.solo");

    const edgePairs = graph.edges.map((e) => `${e.source}→${e.target}`);
    expect(edgePairs).toContain("workspace-root→postgres-root");
    expect(edgePairs).toContain("postgres-root→postgres-project::solo");
    expect(edgePairs).toContain("postgres-project::solo→resources.postgres_projects.solo");
  });

  test("no postgres-root when no postgres resources", () => {
    const graph = buildResourceGraph({
      plan: {
        "resources.jobs.my_job": { action: "create" },
      },
    });

    const nodeIds = graph.nodes.map((n) => n.id);
    expect(nodeIds).not.toContain("postgres-root");
  });
});

describe("lakebase hierarchy", () => {
  test("full chain: workspace-root → lakebase-root → instance group → synced_table", () => {
    const graph = buildResourceGraph({
      plan: {
        "resources.database_instances.my_instance": {
          action: "create",
          new_state: { value: { name: "my_instance" } },
        },
        "resources.synced_database_tables.my_table": {
          action: "create",
          new_state: { value: { name: "my_table", database_instance_name: "my_instance" } },
        },
      },
    });

    const nodeIds = graph.nodes.map((n) => n.id);
    expect(nodeIds).toContain("workspace-root");
    expect(nodeIds).toContain("lakebase-root");
    expect(nodeIds).toContain("lakebase-instance::my_instance");
    expect(nodeIds).toContain("resources.synced_database_tables.my_table");

    const edgePairs = graph.edges.map((e) => `${e.source}→${e.target}`);
    expect(edgePairs).toContain("workspace-root→lakebase-root");
    expect(edgePairs).toContain("lakebase-root→lakebase-instance::my_instance");
    expect(edgePairs).toContain(
      "lakebase-instance::my_instance→resources.synced_database_tables.my_table",
    );

    // Narrow: .external lives on ResourceGroupGraphNode, not the base union
    const instanceGroup = graph.nodes.find((n) => n.id === "lakebase-instance::my_instance");
    expect((instanceGroup as ResourceGroupGraphNode | undefined)?.external).toBe(false);
  });

  test("instance group is external when instance not a plan entry", () => {
    const graph = buildResourceGraph({
      plan: {
        "resources.synced_database_tables.my_table": {
          action: "create",
          new_state: { value: { name: "my_table", database_instance_name: "ext_instance" } },
        },
      },
    });

    const instanceGroup = graph.nodes.find((n) => n.id === "lakebase-instance::ext_instance");
    expect(instanceGroup).toBeDefined();
    expect((instanceGroup as ResourceGroupGraphNode | undefined)?.external).toBe(true);
  });

  test("synced_table with no database_instance_name falls back to lakebase-root", () => {
    const graph = buildResourceGraph({
      plan: {
        "resources.synced_database_tables.orphan": {
          action: "create",
          new_state: { value: { name: "orphan" } },
        },
      },
    });

    const edgePairs = graph.edges.map((e) => `${e.source}→${e.target}`);
    expect(edgePairs).toContain("lakebase-root→resources.synced_database_tables.orphan");
  });

  test("no lakebase-root when no lakebase resources", () => {
    const graph = buildResourceGraph({
      plan: {
        "resources.jobs.my_job": { action: "create" },
      },
    });

    const nodeIds = graph.nodes.map((n) => n.id);
    expect(nodeIds).not.toContain("lakebase-root");
  });
});

describe("cross-hierarchy (lakebase → UC)", () => {
  test("database_catalog with database_instance_name creates cross-edge", () => {
    const graph = buildResourceGraph({
      plan: {
        "resources.database_catalogs.lb_cat": {
          action: "create",
          new_state: { value: { name: "lb_cat", database_instance_name: "my_instance" } },
        },
        "resources.database_instances.my_instance": {
          action: "create",
          new_state: { value: { name: "my_instance" } },
        },
      },
    });

    const edgePairs = graph.edges.map((e) => `${e.source}→${e.target}`);
    // Cross-edge from lakebase instance to UC catalog
    expect(edgePairs).toContain(
      "lakebase-instance::my_instance→resources.database_catalogs.lb_cat",
    );
    // Catalog still appears under UC
    expect(edgePairs).toContain("uc-root→resources.database_catalogs.lb_cat");
  });

  test("database_catalog without database_instance_name creates no cross-edge", () => {
    const graph = buildResourceGraph({
      plan: {
        "resources.database_catalogs.plain_cat": {
          action: "create",
          new_state: { value: { name: "plain_cat" } },
        },
      },
    });

    const edgePairs = graph.edges.map((e) => `${e.source}→${e.target}`);
    const crossEdges = edgePairs.filter((p) => p.includes("lakebase-instance::"));
    expect(crossEdges).toHaveLength(0);

    // No lakebase-root created
    const nodeIds = graph.nodes.map((n) => n.id);
    expect(nodeIds).not.toContain("lakebase-root");
  });

  test("database_catalog with schema still nests schema under catalog in UC", () => {
    const graph = buildResourceGraph({
      plan: {
        "resources.database_catalogs.lb_cat": {
          action: "create",
          new_state: { value: { name: "lb_cat", database_instance_name: "my_instance" } },
        },
        "resources.schemas.lb_schema": {
          action: "create",
          new_state: { value: { catalog_name: "lb_cat", name: "lb_schema" } },
        },
        "resources.database_instances.my_instance": {
          action: "create",
          new_state: { value: { name: "my_instance" } },
        },
      },
    });

    const edgePairs = graph.edges.map((e) => `${e.source}→${e.target}`);
    // UC hierarchy intact
    expect(edgePairs).toContain("catalog::lb_cat→resources.schemas.lb_schema");
    // Cross-edge also present
    expect(edgePairs).toContain(
      "lakebase-instance::my_instance→resources.database_catalogs.lb_cat",
    );
  });

  test("phantom instance from catalog-only reference", () => {
    const graph = buildResourceGraph({
      plan: {
        "resources.database_catalogs.lb_cat": {
          action: "create",
          new_state: { value: { name: "lb_cat", database_instance_name: "phantom_instance" } },
        },
      },
    });

    const nodeIds = graph.nodes.map((n) => n.id);
    // Lakebase hierarchy created even though no lakebase entries exist
    expect(nodeIds).toContain("lakebase-root");
    expect(nodeIds).toContain("lakebase-instance::phantom_instance");

    // Narrow: .external lives on ResourceGroupGraphNode, not the base union
    const instanceGroup = graph.nodes.find((n) => n.id === "lakebase-instance::phantom_instance");
    expect((instanceGroup as ResourceGroupGraphNode | undefined)?.external).toBe(true);

    const edgePairs = graph.edges.map((e) => `${e.source}→${e.target}`);
    expect(edgePairs).toContain("workspace-root→lakebase-root");
    expect(edgePairs).toContain("lakebase-root→lakebase-instance::phantom_instance");
    expect(edgePairs).toContain(
      "lakebase-instance::phantom_instance→resources.database_catalogs.lb_cat",
    );
  });
});

describe("mixed plan with all 4 sections", () => {
  test("creates correct structure for UC + workspace + postgres + lakebase", () => {
    const graph = buildResourceGraph({
      plan: {
        // UC
        "resources.schemas.analytics": {
          action: "update",
          new_state: { value: { catalog_name: "dagshund", name: "analytics" } },
        },
        // Workspace (flat)
        "resources.jobs.etl_pipeline": { action: "create" },
        // Postgres
        "resources.postgres_projects.pg_proj": {
          action: "create",
          new_state: { value: { name: "pg_proj" } },
        },
        "resources.postgres_branches.pg_branch": {
          action: "create",
          new_state: { value: { name: "pg_branch", parent: "pg_proj" } },
        },
        // Lakebase
        "resources.database_instances.lb_inst": {
          action: "create",
          new_state: { value: { name: "lb_inst" } },
        },
        "resources.synced_database_tables.lb_table": {
          action: "create",
          new_state: { value: { name: "lb_table", database_instance_name: "lb_inst" } },
        },
      },
    });

    const nodeIds = graph.nodes.map((n) => n.id);
    // All roots present
    expect(nodeIds).toContain("uc-root");
    expect(nodeIds).toContain("workspace-root");
    expect(nodeIds).toContain("postgres-root");
    expect(nodeIds).toContain("lakebase-root");

    // Group nodes
    expect(nodeIds).toContain("catalog::dagshund");
    expect(nodeIds).toContain("postgres-project::pg_proj");
    expect(nodeIds).toContain("lakebase-instance::lb_inst");

    // Resource nodes
    expect(nodeIds).toContain("resources.schemas.analytics");
    expect(nodeIds).toContain("resources.jobs.etl_pipeline");
    expect(nodeIds).toContain("resources.postgres_projects.pg_proj");
    expect(nodeIds).toContain("resources.postgres_branches.pg_branch");
    expect(nodeIds).toContain("resources.database_instances.lb_inst");
    expect(nodeIds).toContain("resources.synced_database_tables.lb_table");

    const edgePairs = graph.edges.map((e) => `${e.source}→${e.target}`);
    // UC edges
    expect(edgePairs).toContain("uc-root→catalog::dagshund");
    expect(edgePairs).toContain("catalog::dagshund→resources.schemas.analytics");
    // Workspace flat
    expect(edgePairs).toContain("workspace-root→resources.jobs.etl_pipeline");
    // Postgres hierarchy
    expect(edgePairs).toContain("workspace-root→postgres-root");
    expect(edgePairs).toContain("postgres-root→postgres-project::pg_proj");
    expect(edgePairs).toContain("postgres-project::pg_proj→resources.postgres_branches.pg_branch");
    // Lakebase hierarchy
    expect(edgePairs).toContain("workspace-root→lakebase-root");
    expect(edgePairs).toContain("lakebase-root→lakebase-instance::lb_inst");
    expect(edgePairs).toContain(
      "lakebase-instance::lb_inst→resources.synced_database_tables.lb_table",
    );
  });
});

describe("all-hierarchies-plan.json fixture", () => {
  test("creates all four root sections", async () => {
    const plan = await loadFixture("all-hierarchies-plan.json");
    const graph = buildResourceGraph(plan);

    const groupIds = graph.nodes.filter((n) => n.nodeKind === "resource-group").map((n) => n.id);

    expect(groupIds).toContain("uc-root");
    expect(groupIds).toContain("workspace-root");
    expect(groupIds).toContain("postgres-root");
    expect(groupIds).toContain("lakebase-root");
  });

  test("UC hierarchy includes catalog, schemas, phantom schema, and leaf resources", async () => {
    const plan = await loadFixture("all-hierarchies-plan.json");
    const graph = buildResourceGraph(plan);

    const nodeIds = graph.nodes.map((n) => n.id);
    // Deployed catalog with its schema
    expect(nodeIds).toContain("catalog::production");
    expect(nodeIds).toContain("resources.catalogs.production");
    expect(nodeIds).toContain("resources.schemas.reporting");
    // Phantom catalog group (dagshund has no explicit catalogs entry, inferred from schemas)
    expect(nodeIds).toContain("catalog::dagshund");
    // Phantom schema for partner_feeds volume (references schema "integrations" not in plan)
    expect(nodeIds).toContain("external::dagshund.integrations");

    const edgePairs = graph.edges.map((e) => `${e.source}→${e.target}`);
    // Deployed catalog hierarchy
    expect(edgePairs).toContain("uc-root→catalog::production");
    expect(edgePairs).toContain("uc-root→resources.catalogs.production");
    expect(edgePairs).toContain("catalog::production→resources.schemas.reporting");
    // Phantom dagshund catalog hierarchy
    expect(edgePairs).toContain("uc-root→catalog::dagshund");
    expect(edgePairs).toContain("catalog::dagshund→resources.schemas.analytics");
    expect(edgePairs).toContain("catalog::dagshund→resources.schemas.ml_features");
    // Volume links through real schema
    expect(edgePairs).toContain("resources.schemas.analytics→resources.volumes.raw_data");
    // Volume links through phantom schema
    expect(edgePairs).toContain("catalog::dagshund→external::dagshund.integrations");
    expect(edgePairs).toContain("external::dagshund.integrations→resources.volumes.partner_feeds");
    // Deleted model links through real schema
    expect(edgePairs).toContain(
      "resources.schemas.analytics→resources.registered_models.churn_predictor",
    );

    // Narrow: .external lives on ResourceGroupGraphNode, not the base union
    // Deployed catalog is real (has explicit catalogs entry)
    const prodCatalog = graph.nodes.find((n) => n.id === "catalog::production");
    expect((prodCatalog as ResourceGroupGraphNode | undefined)?.external).toBe(false);
    // dagshund catalog group is phantom (no explicit catalogs entry, inferred from schemas)
    const catalogGroup = graph.nodes.find((n) => n.id === "catalog::dagshund");
    expect((catalogGroup as ResourceGroupGraphNode | undefined)?.external).toBe(true);
    const phantomSchema = graph.nodes.find((n) => n.id === "external::dagshund.integrations");
    expect((phantomSchema as ResourceGroupGraphNode | undefined)?.external).toBe(true);
  });

  test("postgres hierarchy has 3-tier chain with phantom branch", async () => {
    const plan = await loadFixture("all-hierarchies-plan.json");
    const graph = buildResourceGraph(plan);

    const nodeIds = graph.nodes.map((n) => n.id);
    expect(nodeIds).toContain("postgres-project::warehouse_replica");
    expect(nodeIds).toContain("resources.postgres_branches.staging");
    expect(nodeIds).toContain("resources.postgres_branches.production");
    expect(nodeIds).toContain("resources.postgres_endpoints.staging_read");
    expect(nodeIds).toContain("resources.postgres_endpoints.production_rw");
    // Phantom branch for legacy_reader (parent: "archive" not in plan)
    expect(nodeIds).toContain("external::postgres-branch::archive");

    const edgePairs = graph.edges.map((e) => `${e.source}→${e.target}`);
    // Full chains
    expect(edgePairs).toContain("workspace-root→postgres-root");
    expect(edgePairs).toContain("postgres-root→postgres-project::warehouse_replica");
    expect(edgePairs).toContain(
      "postgres-project::warehouse_replica→resources.postgres_branches.staging",
    );
    expect(edgePairs).toContain(
      "postgres-project::warehouse_replica→resources.postgres_branches.production",
    );
    expect(edgePairs).toContain(
      "resources.postgres_branches.staging→resources.postgres_endpoints.staging_read",
    );
    expect(edgePairs).toContain(
      "resources.postgres_branches.production→resources.postgres_endpoints.production_rw",
    );
    // Phantom branch chain
    expect(edgePairs).toContain("postgres-root→external::postgres-branch::archive");
    expect(edgePairs).toContain(
      "external::postgres-branch::archive→resources.postgres_endpoints.legacy_reader",
    );
  });

  test("lakebase hierarchy has phantom instance and cross-edge to UC", async () => {
    const plan = await loadFixture("all-hierarchies-plan.json");
    const graph = buildResourceGraph(plan);

    const nodeIds = graph.nodes.map((n) => n.id);
    // Real instance
    expect(nodeIds).toContain("lakebase-instance::analytics_db");
    // Phantom instance (partner_metrics references "reporting_db" not in plan)
    expect(nodeIds).toContain("lakebase-instance::reporting_db");

    const edgePairs = graph.edges.map((e) => `${e.source}→${e.target}`);
    // Real instance chain
    expect(edgePairs).toContain("workspace-root→lakebase-root");
    expect(edgePairs).toContain("lakebase-root→lakebase-instance::analytics_db");
    expect(edgePairs).toContain(
      "lakebase-instance::analytics_db→resources.synced_database_tables.customer_360",
    );
    expect(edgePairs).toContain(
      "lakebase-instance::analytics_db→resources.synced_database_tables.product_events",
    );
    // Phantom instance chain
    expect(edgePairs).toContain("lakebase-root→lakebase-instance::reporting_db");
    expect(edgePairs).toContain(
      "lakebase-instance::reporting_db→resources.synced_database_tables.partner_metrics",
    );
    // Cross-hierarchy edge: lakebase instance → UC database_catalog
    expect(edgePairs).toContain(
      "lakebase-instance::analytics_db→resources.database_catalogs.lakebase_analytics",
    );

    // Narrow: .external lives on ResourceGroupGraphNode, not the base union
    const realInstance = graph.nodes.find((n) => n.id === "lakebase-instance::analytics_db");
    expect((realInstance as ResourceGroupGraphNode | undefined)?.external).toBe(false);
    const phantomInstance = graph.nodes.find((n) => n.id === "lakebase-instance::reporting_db");
    expect((phantomInstance as ResourceGroupGraphNode | undefined)?.external).toBe(true);
  });

  test("workspace flat resources are under workspace-root", async () => {
    const plan = await loadFixture("all-hierarchies-plan.json");
    const graph = buildResourceGraph(plan);

    const edgePairs = graph.edges.map((e) => `${e.source}→${e.target}`);
    expect(edgePairs).toContain("workspace-root→resources.jobs.etl_pipeline");
    expect(edgePairs).toContain("workspace-root→resources.alerts.data_freshness");
    expect(edgePairs).toContain("workspace-root→resources.experiments.ab_test_v2");
    expect(edgePairs).toContain("workspace-root→resources.external_locations.raw_landing_zone");
  });

  test("has correct total resource count", async () => {
    const plan = await loadFixture("all-hierarchies-plan.json");
    const graph = buildResourceGraph(plan);

    const resourceNodes = graph.nodes.filter((n) => n.nodeKind === "resource");
    // 8 UC + 4 workspace + 6 postgres + 4 lakebase = 22
    expect(resourceNodes).toHaveLength(22);
  });
});
