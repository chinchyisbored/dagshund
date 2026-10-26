import { describe, expect, test } from "bun:test";
import { buildChainGraph } from "../../src/graph/build-hierarchy-graph.ts";
import { UC_CHAIN } from "../../src/graph/hierarchy-specs.ts";
import { resolveExternalConnectionReference } from "../../src/graph/resolve-external-connection.ts";
import { preparePlan } from "../../src/preparation/prepare-plan.ts";
import { normalizePlan } from "../../src/utils/normalize-plan.ts";
import { buildResourceGraphFromPlan } from "../helpers/build-graphs-from-plan.ts";

describe("external Unity Catalog references", () => {
  test("places a managed external location and its credential directly under UC", () => {
    const graph = buildResourceGraphFromPlan({
      plan: {
        "resources.external_locations.location": {
          action: "update",
          new_state: { value: { name: "landing", credential_name: "storage-prod" } },
        },
      },
    });

    expect(graph.nodes.filter((node) => node.id === "uc-root")).toHaveLength(1);
    expect(graph.nodes.map((node) => node.id)).toContain("resources.external_locations.location");
    expect(graph.nodes.map((node) => node.id)).toContain("storage-credential::storage-prod");
    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        source: "uc-root",
        target: "resources.external_locations.location",
      }),
    );
    expect(graph.edges).toContainEqual(
      expect.objectContaining({ source: "uc-root", target: "storage-credential::storage-prod" }),
    );
    expect(graph.lateralEdges).toContainEqual(
      expect.objectContaining({
        source: "resources.external_locations.location",
        target: "storage-credential::storage-prod",
      }),
    );
    expect(graph.nodes.some((node) => node.id === "workspace-root")).toBe(false);
  });

  test("does not resurrect a historical credential from an empty current snapshot", () => {
    const graph = buildResourceGraphFromPlan({
      plan: {
        "resources.external_locations.location": {
          action: "update",
          new_state: { value: {} },
          remote_state: { name: "landing", credential_name: "old-credential" },
        },
      },
    });

    expect(graph.nodes.map((node) => node.id)).toContain("resources.external_locations.location");
    expect(graph.nodes.some((node) => node.id === "storage-credential::old-credential")).toBe(
      false,
    );
  });

  test("keeps the real external location when credential_name is malformed", () => {
    const graph = buildResourceGraphFromPlan({
      plan: {
        "resources.external_locations.location": {
          action: "update",
          new_state: { value: { name: "landing", credential_name: { secret: "PRIVATE" } } },
        },
      },
    });

    expect(graph.nodes.map((node) => node.id)).toContain("resources.external_locations.location");
    expect(graph.nodes.some((node) => node.id.startsWith("storage-credential::"))).toBe(false);
  });

  test("does not invent a credential when an external location omits it", () => {
    const graph = buildResourceGraphFromPlan({
      plan: {
        "resources.external_locations.location": {
          action: "delete",
          remote_state: { name: "landing" },
        },
      },
    });

    expect(graph.nodes.map((node) => node.id)).toContain("resources.external_locations.location");
    expect(graph.nodes.some((node) => node.id.startsWith("storage-credential::"))).toBe(false);
  });

  test("keeps app UC securable types distinct and reuses a managed volume", () => {
    const graph = buildResourceGraphFromPlan({
      plan: {
        "resources.volumes.managed": {
          action: "create",
          new_state: {
            value: { catalog_name: "main", schema_name: "analytics", name: "shared" },
          },
        },
        "resources.apps.app": {
          action: "create",
          new_state: {
            value: {
              resources: [
                {
                  uc_securable: {
                    securable_type: "TABLE",
                    securable_full_name: "main.analytics.shared",
                  },
                },
                {
                  uc_securable: {
                    securable_type: "VOLUME",
                    securable_full_name: "main.analytics.shared",
                  },
                },
                {
                  uc_securable: {
                    securable_type: "FUNCTION",
                    securable_full_name: "main.analytics.shared",
                  },
                },
                {
                  uc_securable: {
                    securable_type: "CONNECTION",
                    securable_full_name: "main.analytics.shared",
                  },
                },
              ],
            },
          },
        },
      },
    });

    expect(graph.nodes.map((node) => node.id)).toContain("source-table::main.analytics.shared");
    expect(graph.nodes.map((node) => node.id)).toContain("function::main.analytics.shared");
    expect(graph.nodes.map((node) => node.id)).not.toContain("volume::main.analytics.shared");
    expect(graph.lateralEdges).toContainEqual(
      expect.objectContaining({
        source: "resources.apps.app",
        target: "resources.volumes.managed",
      }),
    );
    expect(
      graph.lateralEdges.some(
        (edge) =>
          edge.source === "resources.apps.app" &&
          edge.target === "source-table::main.analytics.shared",
      ),
    ).toBe(true);
    expect(
      graph.lateralEdges.some((edge) => edge.target === "function::main.analytics.shared"),
    ).toBe(true);
    expect(graph.lateralEdges.some((edge) => edge.target.startsWith("external-connection::"))).toBe(
      false,
    );
  });

  test("uses volume full_name to place under a real schema when only catalog_name is present", () => {
    const graph = buildResourceGraphFromPlan({
      plan: {
        "resources.catalogs.main": { action: "create", new_state: { value: { name: "main" } } },
        "resources.schemas.analytics": {
          action: "create",
          new_state: { value: { catalog_name: "main", name: "analytics" } },
        },
        "resources.volumes.managed": {
          action: "create",
          new_state: { value: { catalog_name: "main", full_name: "main.analytics.shared" } },
        },
        "resources.apps.app": {
          action: "create",
          new_state: {
            value: {
              resources: [
                {
                  uc_securable: {
                    securable_type: "VOLUME",
                    securable_full_name: "main.analytics.shared",
                  },
                },
              ],
            },
          },
        },
      },
    });

    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        source: "resources.schemas.analytics",
        target: "resources.volumes.managed",
      }),
    );
    expect(graph.edges).not.toContainEqual(
      expect.objectContaining({ source: "catalog::main", target: "resources.volumes.managed" }),
    );
  });

  test("places a full-name-only managed volume under its schema", () => {
    const graph = buildResourceGraphFromPlan({
      plan: {
        "resources.catalogs.main": {
          action: "create",
          new_state: { value: { name: "main" } },
        },
        "resources.schemas.analytics": {
          action: "create",
          new_state: { value: { catalog_name: "main", name: "analytics" } },
        },
        "resources.volumes.managed": {
          action: "create",
          new_state: { value: { full_name: "main.analytics.shared" } },
        },
        "resources.apps.app": {
          action: "create",
          new_state: {
            value: {
              resources: [
                {
                  uc_securable: {
                    securable_type: "VOLUME",
                    securable_full_name: "main.analytics.shared",
                  },
                },
              ],
            },
          },
        },
      },
    });

    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        source: "resources.schemas.analytics",
        target: "resources.volumes.managed",
      }),
    );
    expect(graph.lateralEdges).toContainEqual(
      expect.objectContaining({
        source: "resources.apps.app",
        target: "resources.volumes.managed",
      }),
    );
  });

  test("infers missing UC ancestors for a full-name-only managed volume", () => {
    const graph = buildResourceGraphFromPlan({
      plan: {
        "resources.volumes.managed": {
          action: "create",
          new_state: { value: { full_name: "main.analytics.shared" } },
        },
        "resources.apps.app": {
          action: "create",
          new_state: {
            value: {
              resources: [
                {
                  uc_securable: {
                    securable_type: "VOLUME",
                    securable_full_name: "main.analytics.shared",
                  },
                },
              ],
            },
          },
        },
      },
    });

    expect(graph.edges).toContainEqual(
      expect.objectContaining({ source: "uc-root", target: "catalog::main" }),
    );
    expect(graph.edges).toContainEqual(
      expect.objectContaining({ source: "catalog::main", target: "schema::main.analytics" }),
    );
    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        source: "schema::main.analytics",
        target: "resources.volumes.managed",
      }),
    );
    expect(graph.lateralEdges).toContainEqual(
      expect.objectContaining({
        source: "resources.apps.app",
        target: "resources.volumes.managed",
      }),
    );
  });

  test("uses the selected volume snapshot for full-name placement and identity", () => {
    const currentEmpty = buildResourceGraphFromPlan({
      plan: {
        "resources.volumes.managed": {
          action: "update",
          new_state: { value: {} },
          remote_state: { full_name: "main.analytics.shared" },
        },
        "resources.apps.app": {
          action: "create",
          new_state: {
            value: {
              resources: [
                {
                  uc_securable: {
                    securable_type: "VOLUME",
                    securable_full_name: "main.analytics.shared",
                  },
                },
              ],
            },
          },
        },
      },
    });
    const deleted = buildResourceGraphFromPlan({
      plan: {
        "resources.volumes.managed": {
          action: "delete",
          remote_state: { full_name: "main.analytics.shared" },
        },
        "resources.apps.app": {
          action: "create",
          new_state: {
            value: {
              resources: [
                {
                  uc_securable: {
                    securable_type: "VOLUME",
                    securable_full_name: "main.analytics.shared",
                  },
                },
              ],
            },
          },
        },
      },
    });

    expect(currentEmpty.lateralEdges).toContainEqual(
      expect.objectContaining({
        source: "resources.apps.app",
        target: "volume::main.analytics.shared",
      }),
    );
    expect(currentEmpty.lateralEdges).not.toContainEqual(
      expect.objectContaining({
        source: "resources.apps.app",
        target: "resources.volumes.managed",
      }),
    );
    expect(deleted.lateralEdges).toContainEqual(
      expect.objectContaining({ target: "resources.volumes.managed" }),
    );
    expect(deleted.edges).toContainEqual(
      expect.objectContaining({
        source: "schema::main.analytics",
        target: "resources.volumes.managed",
      }),
    );
  });

  test("places typed volume and function phantoms under inferred schemas", () => {
    const graph = buildResourceGraphFromPlan({
      plan: {
        "resources.apps.app": {
          action: "create",
          new_state: {
            value: {
              resources: [
                {
                  uc_securable: {
                    securable_type: "VOLUME",
                    securable_full_name: "main.analytics.shared",
                  },
                },
                {
                  uc_securable: {
                    securable_type: "FUNCTION",
                    securable_full_name: "main.analytics.shared",
                  },
                },
              ],
            },
          },
        },
      },
    });

    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        source: "schema::main.analytics",
        target: "volume::main.analytics.shared",
      }),
    );
    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        source: "schema::main.analytics",
        target: "function::main.analytics.shared",
      }),
    );
    expect(graph.nodes.filter((node) => node.id === "uc-root")).toHaveLength(1);
  });

  test("materializes repeated MCP identities once under shared real UC ancestors", () => {
    const connectionRefs = [
      resolveExternalConnectionReference(
        "resources.mcp_services.first",
        "connections/main.analytics.remote",
      ),
      resolveExternalConnectionReference(
        "resources.mcp_services.second",
        "connections/main.analytics.remote",
      ),
    ].filter((reference) => reference?.kind === "phantom");
    const normalized = normalizePlan({
      "resources.catalogs.main": { action: "create", new_state: { value: { name: "main" } } },
      "resources.schemas.analytics": {
        action: "create",
        new_state: { value: { catalog_name: "main", name: "analytics" } },
      },
    });
    const prepared = preparePlan(normalized);
    const graph = buildChainGraph(
      Object.entries(normalized.entries),
      UC_CHAIN,
      prepared,
      connectionRefs.flatMap((reference) =>
        reference.placement.kind === "hierarchy"
          ? [
              {
                identity: reference.placement.identity,
                phantomId: reference.targetNodeId,
                label: reference.label,
                phantomKind: reference.phantomKind,
              },
            ]
          : [],
      ),
    );

    expect(
      graph.nodes.filter((node) => node.id === "external-connection::main.analytics.remote"),
    ).toHaveLength(1);
    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        source: "resources.schemas.analytics",
        target: "external-connection::main.analytics.remote",
      }),
    );
  });

  test("reuses real schema ancestors for typed app phantoms", () => {
    const graph = buildResourceGraphFromPlan({
      plan: {
        "resources.catalogs.main": { action: "create", new_state: { value: { name: "main" } } },
        "resources.schemas.analytics": {
          action: "create",
          new_state: { value: { catalog_name: "main", name: "analytics" } },
        },
        "resources.apps.app": {
          action: "create",
          new_state: {
            value: {
              resources: ["VOLUME", "FUNCTION"].map((securable_type) => ({
                uc_securable: { securable_type, securable_full_name: "main.analytics.shared" },
              })),
            },
          },
        },
      },
    });

    for (const target of ["volume::main.analytics.shared", "function::main.analytics.shared"]) {
      expect(graph.edges).toContainEqual(
        expect.objectContaining({ source: "resources.schemas.analytics", target }),
      );
      expect(graph.edges).not.toContainEqual(
        expect.objectContaining({ source: "schema::main.analytics", target }),
      );
    }
  });

  test("deduplicates repeated typed app target pairs in the public graph", () => {
    const graph = buildResourceGraphFromPlan({
      plan: {
        "resources.apps.app": {
          action: "create",
          new_state: {
            value: {
              resources: ["VOLUME", "VOLUME", "FUNCTION", "FUNCTION"].map((securable_type) => ({
                uc_securable: { securable_type, securable_full_name: "main.analytics.shared" },
              })),
            },
          },
        },
      },
    });

    expect(graph.lateralEdges.filter((edge) => edge.source === "resources.apps.app")).toHaveLength(
      2,
    );
  });

  test("does not promote non-TABLE app securables into pipeline known tables", () => {
    const graph = buildResourceGraphFromPlan({
      plan: {
        "resources.apps.app": {
          action: "create",
          new_state: {
            value: {
              resources: [
                {
                  uc_securable: {
                    securable_type: "VOLUME",
                    securable_full_name: "main.analytics.shared",
                  },
                },
              ],
            },
          },
        },
        "resources.pipelines.ingest": {
          action: "create",
          new_state: {
            value: {
              ingestion_definition: {
                objects: [{ schema: { source_catalog: "main", source_schema: "analytics" } }],
              },
            },
          },
        },
      },
    });

    expect(graph.lateralEdges).not.toContainEqual(
      expect.objectContaining({
        source: "resources.pipelines.ingest",
        target: "schema::main.analytics",
      }),
    );
  });

  test("typed app references honor current-empty and delete snapshots", () => {
    const entries = {
      "resources.apps.current": {
        action: "update",
        new_state: { value: {} },
        remote_state: {
          resources: [
            {
              uc_securable: { securable_type: "TABLE", securable_full_name: "main.analytics.old" },
            },
          ],
        },
      },
      "resources.apps.deleted": {
        action: "delete",
        remote_state: {
          resources: [
            {
              uc_securable: {
                securable_type: "TABLE",
                securable_full_name: "main.analytics.remote",
              },
            },
          ],
        },
      },
    } as const;
    const graph = buildResourceGraphFromPlan({ plan: entries });

    expect(graph.lateralEdges.some((edge) => edge.source === "resources.apps.current")).toBe(false);
    expect(graph.lateralEdges).toContainEqual(
      expect.objectContaining({
        source: "resources.apps.deleted",
        target: "source-table::main.analytics.remote",
      }),
    );
    expect(graph.nodes.some((node) => node.id === "source-table::main.analytics.old")).toBe(false);
  });

  test("materializes MCP references with inferred ancestors when no managed hierarchy exists", () => {
    const reference = resolveExternalConnectionReference(
      "resources.mcp_services.service",
      "connections/main.analytics.remote",
    );
    if (reference?.kind !== "phantom" || reference.placement.kind !== "hierarchy") {
      throw new Error("valid MCP connection must resolve to a hierarchy phantom");
    }
    const graph = buildChainGraph([], UC_CHAIN, preparePlan(normalizePlan({})), [
      {
        identity: reference.placement.identity,
        phantomId: reference.targetNodeId,
        label: reference.label,
        phantomKind: reference.phantomKind,
      },
    ]);

    expect(graph.nodes.filter((node) => node.id === "uc-root")).toHaveLength(1);
    expect(graph.nodes.filter((node) => node.id === "catalog::main")).toHaveLength(1);
    expect(graph.nodes.filter((node) => node.id === "schema::main.analytics")).toHaveLength(1);
    expect(graph.nodes.filter((node) => node.id === reference.targetNodeId)).toHaveLength(1);
    expect(graph.edges).toContainEqual(
      expect.objectContaining({ source: "schema::main.analytics", target: reference.targetNodeId }),
    );
  });

  test("resolves only explicit schema-qualified MCP connection references", () => {
    expect(
      resolveExternalConnectionReference(
        "resources.mcp_services.service",
        "connections/main.analytics.remote",
      ),
    ).toMatchObject({
      kind: "phantom",
      targetNodeId: "external-connection::main.analytics.remote",
      phantomKind: "externalConnection",
      placement: { kind: "hierarchy", identity: "main.analytics.remote", tier: 2 },
    });
    expect(
      resolveExternalConnectionReference("resources.mcp_services.service", "remote"),
    ).toBeUndefined();
    expect(
      resolveExternalConnectionReference(
        "resources.mcp_services.service",
        "connections/main.analytics.remote.extra",
      ),
    ).toBeUndefined();
  });
});
