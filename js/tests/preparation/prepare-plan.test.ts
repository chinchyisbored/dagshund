import { describe, expect, test } from "bun:test";
import { buildResourceGraph } from "../../src/graph/build-resource-graph.ts";
import { parsePlanJson } from "../../src/parser/parse-plan.ts";
import { preparePlan } from "../../src/preparation/prepare-plan.ts";
import { normalizePlan } from "../../src/utils/normalize-plan.ts";

const prepareEntries = (entries: Readonly<Record<string, unknown>>) => {
  const parsed = parsePlanJson({ plan: entries });
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw new Error("test plan must parse");
  return preparePlan(normalizePlan(parsed.data.plan ?? {}));
};

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
      ],
    });
    expect(prepared.byResourceKey.get("resources.apps.unknown")?.appResources).toEqual({
      status: "supported",
      value: [],
    });
    expect(prepared.diagnostics).toEqual([]);
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
