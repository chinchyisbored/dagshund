import { describe, expect, test } from "bun:test";
import {
  buildResourceGraph,
  extractResourceType,
  extractStateField,
  hasNonJobResources,
  isJobEntry,
  isUnityCatalogType,
} from "../../src/graph/build-resource-graph.ts";
import { parsePlanJson } from "../../src/parser/parse-plan.ts";
import type { Plan } from "../../src/types/plan-schema.ts";

const loadFixture = async (name: string): Promise<Plan> => {
  const text = await Bun.file(`tests/fixtures/${name}`).text();
  const result = parsePlanJson(JSON.parse(text));
  if (!result.ok) throw new Error(`Fixture parse failed: ${result.error}`);
  return result.data;
};

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

describe("hasNonJobResources", () => {
  test("returns false for empty plan", () => {
    expect(hasNonJobResources({})).toBe(false);
  });

  test("returns false for jobs-only plan", () => {
    expect(
      hasNonJobResources({
        plan: { "resources.jobs.my_job": { action: "create" } },
      }),
    ).toBe(false);
  });

  test("returns true when non-job resources exist", () => {
    expect(
      hasNonJobResources({
        plan: {
          "resources.jobs.my_job": { action: "create" },
          "resources.schemas.analytics": { action: "update" },
        },
      }),
    ).toBe(true);
  });
});

describe("buildResourceGraph", () => {
  test("returns empty graph for empty plan", () => {
    const graph = buildResourceGraph({});
    expect(graph.nodes).toHaveLength(0);
    expect(graph.edges).toHaveLength(0);
  });

  test("returns empty graph for jobs-only plan", () => {
    const graph = buildResourceGraph({
      plan: { "resources.jobs.my_job": { action: "create" } },
    });
    expect(graph.nodes).toHaveLength(0);
    expect(graph.edges).toHaveLength(0);
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
    expect(phantom?.external).toBe(true);
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
        "resources.schemas.analytics": {
          action: "update",
          new_state: { value: { catalog_name: "dagshund", name: "analytics" } },
        },
      },
    });

    const ucRoot = graph.nodes.find((n) => n.id === "uc-root");
    expect(ucRoot?.external).toBe(false);
    const catalog = graph.nodes.find((n) => n.id === "catalog::dagshund");
    expect(catalog?.external).toBe(false);
  });

  test("resource nodes have external: false", () => {
    const graph = buildResourceGraph({
      plan: {
        "resources.schemas.analytics": {
          action: "update",
          new_state: { value: { catalog_name: "dagshund", name: "analytics" } },
        },
      },
    });

    const schema = graph.nodes.find((n) => n.id === "resources.schemas.analytics");
    expect(schema?.external).toBe(false);
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
    test("creates nodes for all 7 non-job resources", async () => {
      const plan = await loadFixture("complex-plan.json");
      const graph = buildResourceGraph(plan);

      const resourceNodes = graph.nodes.filter((n) => n.nodeKind === "resource");
      expect(resourceNodes).toHaveLength(7);

      const resourceIds = resourceNodes.map((n) => n.id);
      expect(resourceIds).toContain("resources.schemas.analytics");
      expect(resourceIds).toContain("resources.schemas.analytics_staging");
      expect(resourceIds).toContain("resources.volumes.raw_data");
      expect(resourceIds).toContain("resources.volumes.external_imports");
      expect(resourceIds).toContain("resources.registered_models.quality_metrics");
      expect(resourceIds).toContain("resources.alerts.stale_pipeline_alert");
      expect(resourceIds).toContain("resources.experiments.audit_analysis");
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

    test("workspace resources are linked to workspace root", async () => {
      const plan = await loadFixture("complex-plan.json");
      const graph = buildResourceGraph(plan);

      const edgePairs = graph.edges.map((e) => `${e.source}→${e.target}`);
      expect(edgePairs).toContain("workspace-root→resources.alerts.stale_pipeline_alert");
      expect(edgePairs).toContain("workspace-root→resources.experiments.audit_analysis");
    });

    test("external_imports volume links through phantom schema node", async () => {
      const plan = await loadFixture("complex-plan.json");
      const graph = buildResourceGraph(plan);

      // Phantom schema node should exist for dagshund_no_dabs
      const phantom = graph.nodes.find(
        (n) => n.id === "external::dagshund.dagshund_no_dabs",
      );
      expect(phantom).toBeDefined();
      expect(phantom?.external).toBe(true);
      expect(phantom?.label).toBe("dagshund_no_dabs");
      expect(phantom?.nodeKind).toBe("resource-group");

      // Edge chain: catalog → phantom → volume
      const edgePairs = graph.edges.map((e) => `${e.source}→${e.target}`);
      expect(edgePairs).toContain(
        "catalog::dagshund→external::dagshund.dagshund_no_dabs",
      );
      expect(edgePairs).toContain(
        "external::dagshund.dagshund_no_dabs→resources.volumes.external_imports",
      );
    });
  });
});
