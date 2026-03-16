import { describe, expect, test } from "bun:test";
import {
  buildResourceGraph,
  isJobEntry,
  isPostgresType,
  isUnityCatalogType,
} from "../../src/graph/build-resource-graph.ts";
import { extractStateField, parseThreePartName } from "../../src/graph/extract-resource-state.ts";
import type { ResourceGraphNode } from "../../src/types/graph-types.ts";
import { extractResourceType } from "../../src/utils/resource-key.ts";
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
    expect(isUnityCatalogType("synced_database_tables")).toBe(true);
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
    const phantoms = graph.nodes.filter((n) => n.id.startsWith("schema::"));
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
    const phantoms = graph.nodes.filter((n) => n.id === "schema::dagshund.ext_schema");
    expect(phantoms).toHaveLength(1);

    // Both volumes link through the phantom
    const edgePairs = graph.edges.map((e) => `${e.source}→${e.target}`);
    expect(edgePairs).toContain("schema::dagshund.ext_schema→resources.volumes.vol_a");
    expect(edgePairs).toContain("schema::dagshund.ext_schema→resources.volumes.vol_b");
  });

  test("real catalog entry creates resource node with hierarchy ID", () => {
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
    expect(ucRoot?.nodeKind).toBe("root");
    const catalog = graph.nodes.find((n) => n.id === "catalog::dagshund");
    expect(catalog?.nodeKind).toBe("resource");
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
    expect(catalog?.nodeKind).toBe("phantom");
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
    expect(ucRoot?.nodeKind).toBe("root");
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

    test("creates UC root, catalog phantom, and workspace root nodes", async () => {
      const plan = await loadFixture("complex-plan.json");
      const graph = buildResourceGraph(plan);

      const rootNodes = graph.nodes.filter((n) => n.nodeKind === "root");
      const rootIds = rootNodes.map((n) => n.id);
      expect(rootIds).toContain("uc-root");
      expect(rootIds).toContain("workspace-root");
      // dagshund catalog is phantom (no explicit catalogs entry in plan)
      const catalog = graph.nodes.find((n) => n.id === "catalog::dagshund");
      expect(catalog?.nodeKind).toBe("phantom");
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
      const phantom = graph.nodes.find((n) => n.id === "schema::dagshund.dagshund_no_dabs");
      expect(phantom).toBeDefined();
      expect(phantom?.label).toBe("dagshund_no_dabs");
      expect(phantom?.nodeKind).toBe("phantom");

      // Edge chain: catalog → phantom → volume
      const edgePairs = graph.edges.map((e) => `${e.source}→${e.target}`);
      expect(edgePairs).toContain("catalog::dagshund→schema::dagshund.dagshund_no_dabs");
      expect(edgePairs).toContain(
        "schema::dagshund.dagshund_no_dabs→resources.volumes.external_imports",
      );
    });
  });

  test("database_catalogs entry with child schema creates resource node with hierarchy ID", () => {
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

    // Container tier: database_catalogs entry uses hierarchy ID as node ID
    const catalog = graph.nodes.find((n) => n.id === "catalog::lakebase_cat");
    expect(catalog).toBeDefined();
    expect(catalog?.nodeKind).toBe("resource");

    const edgePairs = graph.edges.map((e) => `${e.source}→${e.target}`);
    expect(edgePairs).toContain("uc-root→catalog::lakebase_cat");
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
    expect(nodeIds).toContain("catalog::standalone");

    const rootNodes = graph.nodes.filter((n) => n.nodeKind === "root");
    expect(rootNodes).toHaveLength(1); // only uc-root
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

describe("postgres hierarchy", () => {
  test("full chain: workspace-root → postgres-root → project group → branch → endpoint", () => {
    const graph = buildResourceGraph({
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
    const graph = buildResourceGraph({
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

  test("project group is external when no project entry exists", () => {
    const graph = buildResourceGraph({
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
    const graph = buildResourceGraph({
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
    const graph = buildResourceGraph({
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
    const graph = buildResourceGraph({
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
    const graph = buildResourceGraph({
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
    const graph = buildResourceGraph({
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
    const graph = buildResourceGraph({
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
    const graph = buildResourceGraph({
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
    const graph = buildResourceGraph({
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

describe("database_instances as flat workspace resources", () => {
  test("database_instance appears under workspace-root", () => {
    const graph = buildResourceGraph({
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
    const graph = buildResourceGraph({
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
    const graph = buildResourceGraph({
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

  test("database_catalog with schema nests schema under catalog", () => {
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
      },
    });

    const edgePairs = graph.edges.map((e) => `${e.source}→${e.target}`);
    expect(edgePairs).toContain("uc-root→catalog::lb_cat");
    expect(edgePairs).toContain("catalog::lb_cat→resources.schemas.lb_schema");
  });
});

describe("mixed plan with UC + workspace + postgres", () => {
  test("creates correct structure with synced tables in UC and instances in workspace", () => {
    const graph = buildResourceGraph({
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

    // "Other Resources" wraps flat resources when postgres hierarchy exists
    expect(nodeIds).toContain("other-resources-root");

    const edgePairs = graph.edges.map((e) => `${e.source}→${e.target}`);
    // UC: synced table under schema
    expect(edgePairs).toContain("uc-root→catalog::dagshund");
    expect(edgePairs).toContain("catalog::dagshund→resources.schemas.analytics");
    expect(edgePairs).toContain(
      "resources.schemas.analytics→resources.synced_database_tables.lb_table",
    );
    // Workspace: flat resources via other-resources-root
    expect(edgePairs).toContain("workspace-root→other-resources-root");
    expect(edgePairs).toContain("other-resources-root→resources.jobs.etl_pipeline");
    expect(edgePairs).toContain("other-resources-root→resources.database_instances.lb_inst");
    // Postgres hierarchy
    expect(edgePairs).toContain("workspace-root→postgres-root");
    expect(edgePairs).toContain("postgres-root→postgres-project::pg-proj");
    expect(edgePairs).toContain("postgres-project::pg-proj→resources.postgres_branches.pg_branch");
  });
});

describe("all-hierarchies-plan.json fixture", () => {
  test("creates UC, workspace, and postgres root sections (no lakebase-root)", async () => {
    const plan = await loadFixture("all-hierarchies-plan.json");
    const graph = buildResourceGraph(plan);

    const rootIds = graph.nodes.filter((n) => n.nodeKind === "root").map((n) => n.id);

    expect(rootIds).toContain("uc-root");
    expect(rootIds).toContain("workspace-root");
    expect(rootIds).toContain("other-resources-root");
    expect(rootIds).toContain("postgres-root");
    expect(rootIds).not.toContain("lakebase-root");
  });

  test("UC hierarchy includes catalogs, schemas, leaf resources, and synced tables", async () => {
    const plan = await loadFixture("all-hierarchies-plan.json");
    const graph = buildResourceGraph(plan);

    const nodeIds = graph.nodes.map((n) => n.id);
    // Deployed catalogs
    expect(nodeIds).toContain("catalog::production");
    expect(nodeIds).toContain("catalog::lakebase_analytics");
    expect(nodeIds).toContain("resources.schemas.reporting");
    // Phantom catalog (dagshund inferred from schemas)
    expect(nodeIds).toContain("catalog::dagshund");
    // Phantom schema for partner_feeds volume
    expect(nodeIds).toContain("schema::dagshund.integrations");
    // Phantom schema for synced tables under lakebase_analytics
    expect(nodeIds).toContain("schema::lakebase_analytics.analytics_data");
    // Phantom schema for partner_metrics under production
    expect(nodeIds).toContain("schema::production.warehouse");

    // Phantom source table nodes from spec.source_table_full_name
    expect(nodeIds).toContain("source-table::dagshund.analytics.customer_profiles");
    expect(nodeIds).toContain("source-table::dagshund.analytics.product_interactions");
    expect(nodeIds).toContain("source-table::dagshund.integrations.partner_rollup");

    // Synced tables are UC leaf nodes
    expect(nodeIds).toContain("resources.synced_database_tables.customer_360");
    expect(nodeIds).toContain("resources.synced_database_tables.product_events");
    expect(nodeIds).toContain("resources.synced_database_tables.partner_metrics");

    const edgePairs = graph.edges.map((e) => `${e.source}→${e.target}`);
    // Deployed catalog hierarchy
    expect(edgePairs).toContain("uc-root→catalog::production");
    expect(edgePairs).toContain("catalog::production→resources.schemas.reporting");
    // Phantom dagshund catalog
    expect(edgePairs).toContain("uc-root→catalog::dagshund");
    expect(edgePairs).toContain("catalog::dagshund→resources.schemas.analytics");
    expect(edgePairs).toContain("catalog::dagshund→resources.schemas.ml_features");
    // Volume links
    expect(edgePairs).toContain("resources.schemas.analytics→resources.volumes.raw_data");
    expect(edgePairs).toContain("catalog::dagshund→schema::dagshund.integrations");
    expect(edgePairs).toContain("schema::dagshund.integrations→resources.volumes.partner_feeds");
    // Deleted model
    expect(edgePairs).toContain(
      "resources.schemas.analytics→resources.registered_models.churn_predictor",
    );
    // Synced tables under lakebase_analytics catalog → phantom analytics_data schema
    expect(edgePairs).toContain(
      "catalog::lakebase_analytics→schema::lakebase_analytics.analytics_data",
    );
    expect(edgePairs).toContain(
      "schema::lakebase_analytics.analytics_data→resources.synced_database_tables.customer_360",
    );
    expect(edgePairs).toContain(
      "schema::lakebase_analytics.analytics_data→resources.synced_database_tables.product_events",
    );
    // partner_metrics under production catalog → phantom warehouse schema
    expect(edgePairs).toContain("catalog::production→schema::production.warehouse");
    expect(edgePairs).toContain(
      "schema::production.warehouse→resources.synced_database_tables.partner_metrics",
    );

    // Source table phantoms under existing schemas
    expect(edgePairs).toContain(
      "resources.schemas.analytics→source-table::dagshund.analytics.customer_profiles",
    );
    expect(edgePairs).toContain(
      "resources.schemas.analytics→source-table::dagshund.analytics.product_interactions",
    );
    expect(edgePairs).toContain(
      "schema::dagshund.integrations→source-table::dagshund.integrations.partner_rollup",
    );

    // Node kinds
    const prodCatalog = graph.nodes.find((n) => n.id === "catalog::production");
    expect(prodCatalog?.nodeKind).toBe("resource");
    const lbCatalog = graph.nodes.find((n) => n.id === "catalog::lakebase_analytics");
    expect(lbCatalog?.nodeKind).toBe("resource");
    const dagshundCatalog = graph.nodes.find((n) => n.id === "catalog::dagshund");
    expect(dagshundCatalog?.nodeKind).toBe("phantom");
  });

  test("postgres hierarchy has 3-tier chain with phantom branch", async () => {
    const plan = await loadFixture("all-hierarchies-plan.json");
    const graph = buildResourceGraph(plan);

    const nodeIds = graph.nodes.map((n) => n.id);
    expect(nodeIds).toContain("postgres-project::warehouse-replica");
    expect(nodeIds).toContain("resources.postgres_branches.staging");
    expect(nodeIds).toContain("resources.postgres_branches.production");
    expect(nodeIds).toContain("resources.postgres_endpoints.staging_read");
    expect(nodeIds).toContain("resources.postgres_endpoints.production_rw");
    expect(nodeIds).toContain("postgres-branch::warehouse-replica/archive");

    const edgePairs = graph.edges.map((e) => `${e.source}→${e.target}`);
    expect(edgePairs).toContain("workspace-root→postgres-root");
    expect(edgePairs).toContain("postgres-root→postgres-project::warehouse-replica");
    expect(edgePairs).toContain(
      "postgres-project::warehouse-replica→resources.postgres_branches.staging",
    );
    expect(edgePairs).toContain(
      "postgres-project::warehouse-replica→resources.postgres_branches.production",
    );
    expect(edgePairs).toContain(
      "resources.postgres_branches.staging→resources.postgres_endpoints.staging_read",
    );
    expect(edgePairs).toContain(
      "resources.postgres_branches.production→resources.postgres_endpoints.production_rw",
    );
    expect(edgePairs).toContain(
      "postgres-project::warehouse-replica→postgres-branch::warehouse-replica/archive",
    );
    expect(edgePairs).toContain(
      "postgres-branch::warehouse-replica/archive→resources.postgres_endpoints.legacy_reader",
    );
  });

  test("database_instance is a flat workspace resource", async () => {
    const plan = await loadFixture("all-hierarchies-plan.json");
    const graph = buildResourceGraph(plan);

    const nodeIds = graph.nodes.map((n) => n.id);
    expect(nodeIds).toContain("resources.database_instances.analytics_db");

    // Under other-resources-root (postgres hierarchy triggers wrapper)
    const edgePairs = graph.edges.map((e) => `${e.source}→${e.target}`);
    expect(edgePairs).toContain("workspace-root→other-resources-root");
    expect(edgePairs).toContain("other-resources-root→resources.database_instances.analytics_db");
  });

  test("workspace flat resources are wrapped in other-resources-root", async () => {
    const plan = await loadFixture("all-hierarchies-plan.json");
    const graph = buildResourceGraph(plan);

    const edgePairs = graph.edges.map((e) => `${e.source}→${e.target}`);
    expect(edgePairs).toContain("workspace-root→other-resources-root");
    expect(edgePairs).toContain("other-resources-root→resources.jobs.etl_pipeline");
    expect(edgePairs).toContain("other-resources-root→resources.alerts.data_freshness");
    expect(edgePairs).toContain("other-resources-root→resources.experiments.ab_test_v2");
    expect(edgePairs).toContain(
      "other-resources-root→resources.external_locations.raw_landing_zone",
    );
  });

  test("has correct total resource count", async () => {
    const plan = await loadFixture("all-hierarchies-plan.json");
    const graph = buildResourceGraph(plan);

    const resourceNodes = graph.nodes.filter((n) => n.nodeKind === "resource");
    // 11 UC (8 original + 3 synced tables) + 5 workspace (4 original + 1 database_instance) + 6 postgres = 22
    expect(resourceNodes).toHaveLength(22);
  });
});

describe("other-resources-root grouping", () => {
  test("no other-resources-root when only flat workspace resources (no hierarchies)", () => {
    const graph = buildResourceGraph({
      plan: {
        "resources.jobs.job_a": { action: "create" },
        "resources.alerts.alert_a": { action: "create" },
      },
    });

    const nodeIds = graph.nodes.map((n) => n.id);
    expect(nodeIds).not.toContain("other-resources-root");
    // Flat resources connect directly to workspace-root
    const edgePairs = graph.edges.map((e) => `${e.source}→${e.target}`);
    expect(edgePairs).toContain("workspace-root→resources.jobs.job_a");
    expect(edgePairs).toContain("workspace-root→resources.alerts.alert_a");
  });

  test("no other-resources-root when only hierarchies and no flat resources", () => {
    const graph = buildResourceGraph({
      plan: {
        "resources.postgres_projects.pg_proj": {
          action: "create",
          new_state: { value: { project_id: "pg-proj" } },
        },
      },
    });

    const nodeIds = graph.nodes.map((n) => n.id);
    expect(nodeIds).not.toContain("other-resources-root");
    expect(nodeIds).toContain("workspace-root");
    expect(nodeIds).toContain("postgres-root");
  });

  test("other-resources-root wraps flat resources when postgres hierarchy exists", () => {
    const graph = buildResourceGraph({
      plan: {
        "resources.jobs.my_job": { action: "create" },
        "resources.postgres_projects.pg_proj": {
          action: "create",
          new_state: { value: { project_id: "pg-proj" } },
        },
      },
    });

    const nodeIds = graph.nodes.map((n) => n.id);
    expect(nodeIds).toContain("other-resources-root");

    const otherRoot = graph.nodes.find((n) => n.id === "other-resources-root");
    expect(otherRoot?.nodeKind).toBe("root");
    expect(otherRoot?.label).toBe("Other Resources");

    const edgePairs = graph.edges.map((e) => `${e.source}→${e.target}`);
    expect(edgePairs).toContain("workspace-root→other-resources-root");
    expect(edgePairs).toContain("other-resources-root→resources.jobs.my_job");
    expect(edgePairs).not.toContain("workspace-root→resources.jobs.my_job");
  });

  test("database_instances are flat — no other-resources-root without a hierarchy", () => {
    const graph = buildResourceGraph({
      plan: {
        "resources.jobs.my_job": { action: "create" },
        "resources.database_instances.lb_inst": {
          action: "create",
          new_state: { value: { name: "lb_inst", capacity: "CU_1" } },
        },
      },
    });

    const nodeIds = graph.nodes.map((n) => n.id);
    // Both are flat workspace resources — no hierarchy, no wrapper
    expect(nodeIds).not.toContain("other-resources-root");

    const edgePairs = graph.edges.map((e) => `${e.source}→${e.target}`);
    expect(edgePairs).toContain("workspace-root→resources.jobs.my_job");
    expect(edgePairs).toContain("workspace-root→resources.database_instances.lb_inst");
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

describe("all-hierarchies synced tables in UC", () => {
  test("synced_database_tables placed under correct catalogs and schemas", async () => {
    const plan = await loadFixture("all-hierarchies-plan.json");
    const graph = buildResourceGraph(plan);

    const nodeIds = graph.nodes.map((n) => n.id);
    // Synced tables are UC leaf nodes
    expect(nodeIds).toContain("resources.synced_database_tables.customer_360");
    expect(nodeIds).toContain("resources.synced_database_tables.product_events");
    expect(nodeIds).toContain("resources.synced_database_tables.partner_metrics");
    // Phantom schemas for synced table parent resolution
    expect(nodeIds).toContain("schema::lakebase_analytics.analytics_data");
    expect(nodeIds).toContain("schema::production.warehouse");
    // No sync-target:: phantom nodes
    const syncTargets = nodeIds.filter((id) => id.startsWith("sync-target::"));
    expect(syncTargets).toHaveLength(0);

    // Phantom source table nodes from spec.source_table_full_name
    expect(nodeIds).toContain("source-table::dagshund.analytics.customer_profiles");
    expect(nodeIds).toContain("source-table::dagshund.analytics.product_interactions");
    expect(nodeIds).toContain("source-table::dagshund.integrations.partner_rollup");

    const edgePairs = graph.edges.map((e) => `${e.source}→${e.target}`);
    // Synced tables under lakebase_analytics catalog → phantom analytics_data schema
    expect(edgePairs).toContain(
      "catalog::lakebase_analytics→schema::lakebase_analytics.analytics_data",
    );
    expect(edgePairs).toContain(
      "schema::lakebase_analytics.analytics_data→resources.synced_database_tables.customer_360",
    );
    expect(edgePairs).toContain(
      "schema::lakebase_analytics.analytics_data→resources.synced_database_tables.product_events",
    );
    // partner_metrics under production catalog → phantom warehouse schema
    expect(edgePairs).toContain("catalog::production→schema::production.warehouse");
    expect(edgePairs).toContain(
      "schema::production.warehouse→resources.synced_database_tables.partner_metrics",
    );
    // Source table phantoms under existing real/phantom schemas
    expect(edgePairs).toContain(
      "resources.schemas.analytics→source-table::dagshund.analytics.customer_profiles",
    );
    expect(edgePairs).toContain(
      "resources.schemas.analytics→source-table::dagshund.analytics.product_interactions",
    );
    expect(edgePairs).toContain(
      "schema::dagshund.integrations→source-table::dagshund.integrations.partner_rollup",
    );
  });
});

describe("source table phantom nodes", () => {
  test("source in existing real schema creates phantom leaf under real schema node", () => {
    const graph = buildResourceGraph({
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
    const graph = buildResourceGraph({
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
    const graph = buildResourceGraph({
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
    const graph = buildResourceGraph({
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
    const graph = buildResourceGraph({
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
    const graph = buildResourceGraph({
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
    const graph = buildResourceGraph({
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

describe("sub-resources-plan.json (sub-resource merging)", () => {
  test("merges sub-resource keys into parent resource node", async () => {
    const plan = await loadFixture("sub-resources-plan.json");
    const graph = buildResourceGraph(plan);

    const nodeIds = graph.nodes.map((n) => n.id);
    expect(nodeIds).toContain("resources.jobs.test_job");
    expect(nodeIds).not.toContain("resources.jobs.test_job.permissions");
    expect(nodeIds).not.toContain("resources.schemas.analytics.grants");
  });

  test("includes non-sub-resource entries", async () => {
    const plan = await loadFixture("sub-resources-plan.json");
    const graph = buildResourceGraph(plan);

    const resourceKeys = graph.nodes
      .filter((n): n is ResourceGraphNode => n.nodeKind === "resource")
      .map((n) => n.resourceKey);
    expect(resourceKeys).toContain("resources.jobs.test_job");
    expect(resourceKeys).toContain("resources.schemas.analytics");
  });

  test("no edges reference sub-resource keys", async () => {
    const plan = await loadFixture("sub-resources-plan.json");
    const graph = buildResourceGraph(plan);

    for (const edge of [...graph.edges, ...graph.lateralEdges]) {
      expect(edge.source).not.toContain(".permissions");
      expect(edge.source).not.toContain(".grants");
      expect(edge.target).not.toContain(".permissions");
      expect(edge.target).not.toContain(".grants");
    }
  });

  test("parent node has merged permission state from remote_state", async () => {
    const plan = await loadFixture("sub-resources-plan.json");
    const graph = buildResourceGraph(plan);

    const jobNode = graph.nodes.find(
      (n): n is ResourceGraphNode =>
        n.nodeKind === "resource" && n.resourceKey === "resources.jobs.test_job",
    );
    expect(jobNode).toBeDefined();
    const state = jobNode?.resourceState as Record<string, unknown> | undefined;
    expect(state?.["permissions"]).toBeDefined();
  });

  test("schema node has merged grants changes", async () => {
    const plan = await loadFixture("sub-resources-plan.json");
    const graph = buildResourceGraph(plan);

    const schemaNode = graph.nodes.find(
      (n): n is ResourceGraphNode =>
        n.nodeKind === "resource" && n.resourceKey === "resources.schemas.analytics",
    );
    expect(schemaNode).toBeDefined();
    expect(schemaNode?.changes?.["grants.grants[principal='data_team'].privileges"]).toBeDefined();
  });
});
