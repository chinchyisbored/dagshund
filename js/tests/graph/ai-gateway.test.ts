import { describe, expect, test } from "bun:test";
import { preparePlan } from "../../src/preparation/prepare-plan.ts";
import { normalizePlan } from "../../src/utils/normalize-plan.ts";
import { extractTypeBadge } from "../../src/utils/resource-key.ts";
import { buildResourceGraphFromPlan } from "../helpers/build-graphs-from-plan.ts";

const entry = (value: unknown, action: "create" | "update" = "create") => ({
  action,
  new_state: { value },
});

const route = (type: string, config: Readonly<Record<string, unknown>>) => ({
  destination_type: type,
  ...config,
});

type TestResources = Readonly<
  Record<
    string,
    Readonly<{
      action?: "create" | "update" | "delete";
      new_state?: unknown;
      remote_state?: unknown;
      depends_on?: readonly Readonly<{ node: string }>[];
    }>
  >
>;

const buildGraph = (resources: TestResources) => buildResourceGraphFromPlan({ plan: resources });

describe("AI Gateway references", () => {
  test("resolves primary and fallback destinations to API identities and reuses real targets", () => {
    const graph = buildGraph({
      "resources.schemas.schema": entry({ catalog_name: "main", name: "ai" }),
      "resources.model_provider_services.provider": entry({
        parent: "schemas/main.ai",
        model_provider_service_id: "external",
        config: {},
      }),
      "resources.registered_models.model": entry({
        name: "bundle-key",
        full_name: "main.ai.foundation",
      }),
      "resources.model_serving_endpoints.key": entry({ name: "api-endpoint" }),
      "resources.model_services.gateway": entry({
        parent: "schemas/main.ai",
        model_service_id: "gateway",
        config: {
          routing: {
            destinations: [
              route("DESTINATION_TYPE_EXTERNAL_FOUNDATION_MODEL", {
                external_model_config: {
                  model_provider_service: "model-provider-services/main.ai.external",
                },
              }),
            ],
            fallback: {
              destinations: [
                route("DESTINATION_TYPE_PAY_PER_TOKEN_FOUNDATION_MODEL", {
                  pay_per_token_config: { model: "models/main.ai.foundation" },
                }),
                route("DESTINATION_TYPE_PROVISIONED_THROUGHPUT_FOUNDATION_MODEL", {
                  provisioned_throughput_config: {
                    model_serving_endpoint: "serving-endpoints/api-endpoint",
                  },
                }),
              ],
            },
          },
        },
      }),
    });

    expect(graph.lateralEdges.map(({ source, target }) => `${source}->${target}`)).toEqual([
      "resources.model_services.gateway->resources.model_provider_services.provider",
      "resources.model_services.gateway->resources.registered_models.model",
      "resources.model_services.gateway->resources.model_serving_endpoints.key",
    ]);
    expect(extractTypeBadge("resources.model_services.gateway")).toBe("model service");
    expect(extractTypeBadge("resources.model_provider_services.provider")).toBe(
      "model provider service",
    );
  });

  test("does not resolve API names through arbitrary serving-endpoint bundle keys", () => {
    for (const endpoint of [{}, { name: "" }, { name: "different-api" }]) {
      const graph = buildGraph({
        "resources.model_services.gateway": entry({
          parent: "schemas/main.ai",
          model_service_id: "gateway",
          config: {
            routing: {
              destinations: [
                route("DESTINATION_TYPE_PROVISIONED_THROUGHPUT_FOUNDATION_MODEL", {
                  provisioned_throughput_config: {
                    model_serving_endpoint: "serving-endpoints/requested-api",
                  },
                }),
              ],
            },
          },
        }),
        "resources.model_serving_endpoints.requested-api": entry(endpoint),
      });

      expect(graph.lateralEdges.map(({ target }) => target)).toEqual([
        "serving-endpoint::requested-api",
      ]);
      expect(graph.nodes.map(({ id }) => id)).toContain("serving-endpoint::requested-api");
      expect(graph.lateralEdges.map(({ target }) => target)).not.toContain(
        "resources.model_serving_endpoints.requested-api",
      );
    }
  });

  test("creates correctly placed typed phantoms and deduplicates repeated route pairs", () => {
    const graph = buildGraph({
      "resources.model_services.gateway": entry({
        parent: "schemas/main.ai",
        model_service_id: "gateway",
        config: {
          routing: {
            destinations: [
              route("DESTINATION_TYPE_EXTERNAL_FOUNDATION_MODEL", {
                external_model_config: {
                  model_provider_service: "model-provider-services/main.ai.provider",
                },
              }),
              route("DESTINATION_TYPE_EXTERNAL_FOUNDATION_MODEL", {
                external_model_config: {
                  model_provider_service: "model-provider-services/main.ai.provider",
                },
              }),
              route("DESTINATION_TYPE_PAY_PER_TOKEN_FOUNDATION_MODEL", {
                pay_per_token_config: { model: "models/main.ai.model" },
              }),
              route("DESTINATION_TYPE_PROVISIONED_THROUGHPUT_FOUNDATION_MODEL", {
                provisioned_throughput_config: {
                  model_serving_endpoint: "serving-endpoints/api-endpoint",
                },
              }),
            ],
          },
        },
      }),
    });

    expect(graph.nodes.map(({ id }) => id)).toContain("model-provider-service::main.ai.provider");
    expect(graph.nodes.map(({ id }) => id)).toContain("registered-model::main.ai.model");
    expect(graph.nodes.map(({ id }) => id)).toContain("serving-endpoint::api-endpoint");
    expect(graph.lateralEdges).toHaveLength(3);
  });

  test("retains grants-only provider updates and merges grant state and changes", () => {
    const graph = buildResourceGraphFromPlan({
      plan: {
        "resources.model_provider_services.provider": {
          action: "skip",
          new_state: {
            value: {
              parent: "schemas/main.ai",
              model_provider_service_id: "provider",
              config: { safe: true },
            },
          },
          remote_state: {
            parent: "schemas/main.ai",
            model_provider_service_id: "provider",
            config: { safe: true },
          },
        },
        "resources.model_provider_services.provider.grants": {
          action: "update",
          new_state: {
            vars: { full_name: "main.ai.provider" },
            value: {
              securable_type: "model_provider_service",
              __embed__: [{ principal: "readers", privileges: ["EXECUTE"] }],
            },
          },
          changes: {
            '[principal="readers"].privileges': {
              action: "update",
              old: ["USE_CATALOG"],
              new: ["EXECUTE"],
            },
          },
        },
      },
    });
    const provider = graph.nodes.find(
      ({ resourceKey }) => resourceKey === "resources.model_provider_services.provider",
    );

    expect(provider?.diffState).toBe("modified");
    expect(provider?.resourceState).toMatchObject({
      grants: { __embed__: [{ principal: "readers", privileges: ["EXECUTE"] }] },
    });
    expect(provider?.changes?.['grants.[principal="readers"].privileges']).toMatchObject({
      action: "update",
      old: ["USE_CATALOG"],
      new: ["EXECUTE"],
    });
  });

  test("retains service lifecycle diff and raw detail state across supported actions", () => {
    const graph = buildResourceGraphFromPlan({
      plan: {
        "resources.model_services.created": entry({
          parent: "schemas/main.ai",
          model_service_id: "created",
          config: {},
        }),
        "resources.mcp_services.changed": {
          action: "update",
          new_state: {
            value: { parent: "schemas/main.ai", mcp_service_id: "changed", config: { safe: true } },
          },
          remote_state: {
            parent: "schemas/main.ai",
            mcp_service_id: "changed",
            config: { safe: false },
          },
        },
        "resources.model_provider_services.deleted": {
          action: "delete",
          remote_state: {
            parent: "schemas/main.ai",
            model_provider_service_id: "deleted",
            config: { safe: true },
          },
        },
        "resources.model_services.skipped": {
          action: "skip",
          remote_state: { parent: "schemas/main.ai", model_service_id: "skipped" },
        },
        "resources.mcp_services.unrecognized": {
          action: "unknown",
          remote_state: { parent: "schemas/main.ai", mcp_service_id: "unrecognized" },
        },
      },
    });
    const nodes = new Map(graph.nodes.map((node) => [node.resourceKey, node]));

    expect(nodes.get("resources.model_services.created")?.diffState).toBe("added");
    expect(nodes.get("resources.mcp_services.changed")?.diffState).toBe("modified");
    expect(nodes.get("resources.model_provider_services.deleted")?.diffState).toBe("removed");
    expect(nodes.get("resources.model_services.skipped")?.diffState).toBe("unchanged");
    expect(nodes.get("resources.mcp_services.unrecognized")?.diffState).toBe("unknown");
    expect(nodes.get("resources.mcp_services.changed")?.resourceState).toMatchObject({
      config: { safe: true },
    });
    expect(extractTypeBadge("resources.mcp_services.changed")).toBe("MCP service");
  });

  test("reuses registered-model catalog/schema/leaf identity and respects the effective snapshot", () => {
    const current = buildGraph({
      "resources.model_services.gateway": entry({
        parent: "schemas/main.ai",
        model_service_id: "gateway",
        config: {
          routing: {
            destinations: [
              route("DESTINATION_TYPE_PAY_PER_TOKEN_FOUNDATION_MODEL", {
                pay_per_token_config: { model: "models/main.ai.foundation" },
              }),
            ],
          },
        },
      }),
      "resources.registered_models.bundle-key": entry({
        catalog_name: "main",
        schema_name: "ai",
        name: "foundation",
      }),
      "resources.registered_models.foundation": entry({
        catalog_name: "main",
        schema_name: "other",
        name: "foundation",
      }),
    });
    expect(current.nodes.map(({ id }) => id)).not.toContain("registered-model::main.ai.foundation");
    expect(current.lateralEdges.map(({ target }) => target)).toContain(
      "resources.registered_models.bundle-key",
    );

    const collision = buildGraph({
      "resources.model_services.gateway": entry({
        parent: "schemas/main.ai",
        model_service_id: "gateway",
        config: {
          routing: {
            destinations: [
              route("DESTINATION_TYPE_PAY_PER_TOKEN_FOUNDATION_MODEL", {
                pay_per_token_config: { model: "models/main.ai.foundation" },
              }),
            ],
          },
        },
      }),
      "resources.registered_models.foundation": entry({
        name: "foundation",
      }),
      "resources.registered_models.other-schema": entry({
        catalog_name: "main",
        schema_name: "other",
        name: "foundation",
      }),
    });
    expect(collision.nodes.map(({ id }) => id)).toContain("registered-model::main.ai.foundation");
    expect(collision.lateralEdges.map(({ target }) => target)).toEqual([
      "registered-model::main.ai.foundation",
    ]);
    expect(collision.lateralEdges.map(({ target }) => target)).not.toContain(
      "resources.registered_models.foundation",
    );
    expect(collision.lateralEdges.map(({ target }) => target)).not.toContain(
      "resources.registered_models.other-schema",
    );

    const emptyCurrent = buildGraph({
      "resources.model_services.gateway": entry({
        parent: "schemas/main.ai",
        model_service_id: "gateway",
        config: {
          routing: {
            destinations: [
              route("DESTINATION_TYPE_PAY_PER_TOKEN_FOUNDATION_MODEL", {
                pay_per_token_config: { model: "models/main.ai.foundation" },
              }),
            ],
          },
        },
      }),
      "resources.registered_models.bundle-key": {
        action: "update",
        new_state: { value: {} },
        remote_state: { catalog_name: "main", schema_name: "ai", name: "foundation" },
      },
    });
    expect(emptyCurrent.nodes.map(({ id }) => id)).toContain(
      "registered-model::main.ai.foundation",
    );
  });

  test("resolves explicit MCP connections without creating managed connection resources", () => {
    const graph = buildGraph({
      "resources.mcp_services.service": entry({
        parent: "schemas/main.ai",
        mcp_service_id: "mcp",
        config: { source_connection: { name: "connections/main.ai.database" } },
      }),
    });

    expect(graph.nodes.map(({ id }) => id)).toContain("external-connection::main.ai.database");
    expect(graph.lateralEdges).toContainEqual(
      expect.objectContaining({
        source: "resources.mcp_services.service",
        target: "external-connection::main.ai.database",
      }),
    );
    expect(
      graph.nodes.some(({ resourceKey }) => resourceKey === "resources.connections.database"),
    ).toBe(false);
  });

  test("projects only source-schema service credential names as distinct typed references", () => {
    const input = {
      "resources.model_provider_services.aws": entry({
        parent: "schemas/main.ai",
        model_provider_service_id: "aws",
        config: {
          amazon_bedrock: { direct: { service_credential: { name: "credentials/aws" } } },
        },
      }),
      "resources.model_provider_services.azure": entry({
        parent: "schemas/main.ai",
        model_provider_service_id: "azure",
        config: {
          azure_openai: { direct: { service_credential: { name: "credentials/azure" } } },
        },
      }),
      "resources.model_provider_services.foundry": entry({
        parent: "schemas/main.ai",
        model_provider_service_id: "foundry",
        config: {
          microsoft_foundry: { direct: { service_credential: { name: "credentials/foundry" } } },
        },
      }),
    };
    const before = JSON.stringify(input);
    const graph = buildGraph(input);

    expect(graph.nodes.map(({ id }) => id)).toContain("service-credential::aws");
    expect(graph.nodes.map(({ id }) => id)).toContain("service-credential::azure");
    expect(graph.nodes.map(({ id }) => id)).toContain("service-credential::foundry");
    expect(graph.nodes.some(({ id }) => id === "storage-credential::main.ai.aws")).toBe(false);
    expect(JSON.stringify(input)).toBe(before);
  });

  test("shares one UC-root service credential across provider schemas", () => {
    const graph = buildGraph({
      "resources.model_provider_services.first": entry({
        parent: "schemas/main.one",
        model_provider_service_id: "first",
        config: {
          amazon_bedrock: { direct: { service_credential: { name: "credentials/shared" } } },
        },
      }),
      "resources.model_provider_services.second": entry({
        parent: "schemas/main.two",
        model_provider_service_id: "second",
        config: {
          amazon_bedrock: { direct: { service_credential: { name: "credentials/shared" } } },
        },
      }),
    });

    expect(graph.nodes.filter(({ id }) => id === "service-credential::shared")).toHaveLength(1);
    expect(graph.nodes.map(({ id }) => id)).not.toContain("schema::main.one.shared");
    expect(graph.lateralEdges.map(({ target }) => target)).toEqual([
      "service-credential::shared",
      "service-credential::shared",
    ]);
    expect(graph.edges).toContainEqual(
      expect.objectContaining({ source: "uc-root", target: "service-credential::shared" }),
    );
  });

  test("resolves route updates and deletes from effective snapshots with pair deduplication", () => {
    const graph = buildGraph({
      "resources.model_services.updated": {
        action: "update",
        new_state: {
          value: {
            parent: "schemas/main.ai",
            model_service_id: "updated",
            config: {
              routing: {
                destinations: [
                  route("DESTINATION_TYPE_EXTERNAL_FOUNDATION_MODEL", {
                    external_model_config: {
                      model_provider_service: "model-provider-services/main.ai.provider",
                    },
                  }),
                ],
                fallback: {
                  destinations: [
                    route("DESTINATION_TYPE_EXTERNAL_FOUNDATION_MODEL", {
                      external_model_config: {
                        model_provider_service: "model-provider-services/main.ai.provider",
                      },
                    }),
                  ],
                },
              },
            },
          },
        },
        remote_state: {
          parent: "schemas/main.ai",
          config: {
            routing: {
              destinations: [
                route("DESTINATION_TYPE_EXTERNAL_FOUNDATION_MODEL", {
                  external_model_config: {
                    model_provider_service: "model-provider-services/main.ai.historical",
                  },
                }),
              ],
            },
          },
        },
      },
      "resources.model_services.deleted": {
        action: "delete",
        new_state: {
          value: {
            parent: "schemas/main.ai",
            config: {
              routing: {
                destinations: [
                  route("DESTINATION_TYPE_EXTERNAL_FOUNDATION_MODEL", {
                    external_model_config: {
                      model_provider_service: "model-provider-services/main.ai.not-current",
                    },
                  }),
                ],
              },
            },
          },
        },
        remote_state: {
          parent: "schemas/main.ai",
          model_service_id: "deleted",
          config: {
            routing: {
              destinations: [
                route("DESTINATION_TYPE_EXTERNAL_FOUNDATION_MODEL", {
                  external_model_config: {
                    model_provider_service: "model-provider-services/main.ai.deleted",
                  },
                }),
              ],
            },
          },
        },
      },
    });
    const updated = graph.nodes.find(({ id }) => id === "resources.model_services.updated");
    const deleted = graph.nodes.find(({ id }) => id === "resources.model_services.deleted");

    expect(graph.lateralEdges).toHaveLength(2);
    expect(
      graph.lateralEdges.filter(({ source }) => source === "resources.model_services.updated"),
    ).toHaveLength(1);
    expect(graph.lateralEdges).toContainEqual(
      expect.objectContaining({
        source: "resources.model_services.updated",
        target: "model-provider-service::main.ai.provider",
      }),
    );
    expect(graph.lateralEdges.map(({ target }) => target)).not.toContain(
      "model-provider-service::main.ai.historical",
    );
    expect(graph.nodes.map(({ id }) => id)).not.toContain(
      "model-provider-service::main.ai.historical",
    );
    expect(graph.nodes.map(({ id }) => id)).not.toContain(
      "model-provider-service::main.ai.not-current",
    );
    expect(graph.lateralEdges).toContainEqual(
      expect.objectContaining({
        source: "resources.model_services.deleted",
        target: "model-provider-service::main.ai.deleted",
      }),
    );
    expect(updated?.diffState).toBe("modified");
    expect(deleted?.diffState).toBe("removed");
  });

  test("keeps same-leaf identities distinct by schema and resource type", () => {
    const graph = buildGraph({
      "resources.model_services.same": entry({
        parent: "schemas/first.ai",
        model_service_id: "same",
        config: {},
      }),
      "resources.model_services.other": entry({
        parent: "schemas/second.ai",
        model_service_id: "same",
        config: {},
      }),
      "resources.mcp_services.same": entry({
        parent: "schemas/first.ai",
        mcp_service_id: "same",
        config: {},
      }),
      "resources.model_provider_services.same": entry({
        parent: "schemas/first.ai",
        model_provider_service_id: "same",
        config: {},
      }),
    });

    expect(graph.nodes.map(({ id }) => id)).toContain("resources.model_services.same");
    expect(graph.nodes.map(({ id }) => id)).toContain("resources.model_services.other");
    expect(graph.nodes.map(({ id }) => id)).toContain("resources.mcp_services.same");
    expect(graph.nodes.map(({ id }) => id)).toContain("resources.model_provider_services.same");
    expect(graph.nodes.map(({ id }) => id)).toContain("schema::first.ai");
    expect(graph.nodes.map(({ id }) => id)).toContain("schema::second.ai");
  });

  test("reports malformed narrow projections without exposing values and handles effective empty snapshots", () => {
    const malformed = {
      "resources.model_services.gateway": entry({
        model_service_id: "gateway",
        config: { routing: { destinations: "DO_NOT_LEAK" } },
      }),
    };
    const prepared = preparePlan(normalizePlan(malformed));

    expect(prepared.diagnostics).toEqual([
      {
        resourceKey: "resources.model_services.gateway",
        capability: "ai-gateway-references",
        reason: "invalid-shape",
      },
    ]);
    expect(JSON.stringify(prepared.diagnostics)).not.toContain("DO_NOT_LEAK");
    const emptyCurrent = buildGraph({
      "resources.model_services.gateway": {
        action: "update",
        new_state: { value: {} },
        remote_state: {
          parent: "schemas/main.ai",
          model_service_id: "old",
          config: {
            routing: {
              destinations: [
                route("DESTINATION_TYPE_EXTERNAL_FOUNDATION_MODEL", {
                  external_model_config: {
                    model_provider_service: "model-provider-services/main.ai.old",
                  },
                }),
              ],
            },
          },
        },
      },
    });
    expect(emptyCurrent.nodes.map(({ id }) => id)).not.toContain(
      "model-provider-service::main.ai.old",
    );
  });

  test("keeps malformed reference grammar and depends_on-only declarations from creating edges", () => {
    const graph = buildGraph({
      "resources.model_services.gateway": {
        ...entry({
          parent: "schemas/main.ai",
          model_service_id: "gateway",
          config: {
            routing: {
              destinations: [
                route("DESTINATION_TYPE_EXTERNAL_FOUNDATION_MODEL", {
                  external_model_config: {
                    model_provider_service: "resources.model_provider_services.bundle-key",
                  },
                }),
              ],
            },
          },
        }),
        depends_on: [{ node: "resources.model_provider_services.bundle-key" }],
      },
    });

    expect(graph.lateralEdges).toHaveLength(0);
  });
});
