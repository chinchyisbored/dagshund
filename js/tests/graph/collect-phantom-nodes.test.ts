import { describe, expect, test } from "bun:test";
import { buildOrphanEffectPhantoms } from "../../src/graph/collect-phantom-nodes.ts";
import { buildResourceGraphFromPlan } from "../helpers/build-graphs-from-plan.ts";

describe("reference phantom materialization", () => {
  test("app resource phantoms retain specialized handling", () => {
    const graph = buildResourceGraphFromPlan({
      plan: {
        "resources.apps.myapp": {
          action: "create",
          new_state: { value: { resources: [{ job: { id: "123" } }] } },
        },
      },
    });

    expect(graph.nodes.map((node) => node.id)).toContain("job::123");
  });

  test("repeated database-instance references materialize one dot-path phantom", () => {
    const graph = buildResourceGraphFromPlan({
      plan: {
        "resources.synced_database_tables.first": {
          action: "create",
          new_state: { value: { database_instance_name: "instance-a" } },
        },
        "resources.synced_database_tables.second": {
          action: "create",
          new_state: { value: { database_instance_name: "instance-a" } },
        },
        "resources.database_catalogs.catalog": {
          action: "create",
          new_state: { value: { database_instance_name: "instance-a" } },
        },
      },
    });
    const phantoms = graph.nodes.filter((node) => node.id === "database-instance::instance-a");

    expect(phantoms).toHaveLength(1);
    expect(phantoms[0]?.resourceKey).toBe("resources.database_instances.instance-a");
  });

  test("database-instance references create a phantom only through the shared graph path", () => {
    const graph = buildResourceGraphFromPlan({
      plan: {
        "resources.database_catalogs.catalog": {
          action: "create",
          new_state: { value: { database_instance_name: "instance-a" } },
        },
      },
    });

    expect(graph.nodes.map((node) => node.id)).toContain("database-instance::instance-a");
    expect(graph.edges.some((edge) => edge.target === "database-instance::instance-a")).toBe(true);
  });

  test("app references to an absent Genie space create a specialized phantom", () => {
    const graph = buildResourceGraphFromPlan({
      plan: {
        "resources.apps.myapp": {
          action: "create",
          new_state: {
            value: {
              resources: [{ genie_space: { name: "taxi", space_id: "space-1" } }],
            },
          },
        },
      },
    });

    const phantoms = graph.nodes.filter((node) => node.id === "genie-space::taxi");

    expect(phantoms).toHaveLength(1);
    expect(phantoms[0]?.resourceKey).toBe("resources.genie_spaces.taxi");
    expect(phantoms[0]?.nodeKind).toBe("phantom");
  });

  test("app references to an existing Genie space do not create a phantom", () => {
    const graph = buildResourceGraphFromPlan({
      plan: {
        "resources.apps.myapp": {
          action: "create",
          new_state: {
            value: {
              resources: [{ genie_space: { name: "taxi", space_id: "space-1" } }],
            },
          },
        },
        "resources.genie_spaces.taxi": {
          action: "create",
          new_state: { value: { space_id: "space-1" } },
        },
      },
    });

    expect(graph.nodes.some((node) => node.id === "genie-space::taxi")).toBe(false);
  });

  test("app phantoms retain secret-scope and serving-endpoint behavior", () => {
    const absentGraph = buildResourceGraphFromPlan({
      plan: {
        "resources.apps.myapp": {
          action: "create",
          new_state: {
            value: {
              resources: [
                { secret: { scope: "scope-a", key: "token" } },
                { serving_endpoint: { name: "endpoint-a", permission: "CAN_QUERY" } },
              ],
            },
          },
        },
      },
    });

    expect(absentGraph.nodes.map((node) => node.id)).toContain("secret-scope::scope-a");
    expect(absentGraph.nodes.map((node) => node.id)).toContain("serving-endpoint::endpoint-a");
    expect(absentGraph.nodes.find((node) => node.id === "secret-scope::scope-a")?.resourceKey).toBe(
      "resources.secret_scopes.scope-a",
    );
    expect(
      absentGraph.nodes.find((node) => node.id === "serving-endpoint::endpoint-a")?.resourceKey,
    ).toBe("resources.model_serving_endpoints.endpoint-a");

    const existingGraph = buildResourceGraphFromPlan({
      plan: {
        "resources.apps.myapp": {
          action: "create",
          new_state: {
            value: {
              resources: [
                { secret: { scope: "scope-a", key: "token" } },
                { serving_endpoint: { name: "endpoint-a", permission: "CAN_QUERY" } },
              ],
            },
          },
        },
        "resources.secret_scopes.scope-a": {
          action: "create",
          new_state: { value: { name: "scope-a" } },
        },
        "resources.model_serving_endpoints.endpoint-a": {
          action: "create",
          new_state: { value: { name: "endpoint-a" } },
        },
      },
    });

    expect(existingGraph.nodes.some((node) => node.id === "secret-scope::scope-a")).toBe(false);
    expect(existingGraph.nodes.some((node) => node.id === "serving-endpoint::endpoint-a")).toBe(
      false,
    );
  });

  test("app mixed-reference phantom creation deduplicates repeated dependencies", () => {
    const graph = buildResourceGraphFromPlan({
      plan: {
        "resources.apps.myapp": {
          action: "create",
          new_state: {
            value: {
              resources: [
                { job: { id: "123" } },
                { sql_warehouse: { id: "warehouse-a" } },
                { secret: { scope: "scope-a", key: "one" } },
                { secret: { scope: "scope-a", key: "two" } },
              ],
            },
          },
        },
      },
    });
    const ids = graph.nodes.map((node) => node.id);

    expect(ids.filter((id) => id === "secret-scope::scope-a")).toHaveLength(1);
    expect(ids).toContain("job::123");
    expect(ids).toContain("sql-warehouse::warehouse-a");
  });

  test("task references create phantom and lateral edge from shared resolution", () => {
    const graph = buildResourceGraphFromPlan({
      plan: {
        "resources.jobs.source": {
          action: "create",
          new_state: {
            value: {
              tasks: [
                {
                  task_key: "task-a",
                  sql_task: { warehouse_id: "warehouse-missing" },
                },
              ],
            },
          },
        },
      },
    });

    expect(graph.nodes.map((node) => node.id)).toContain("sql-warehouse::warehouse-missing");
    expect(graph.edges.some((edge) => edge.target === "sql-warehouse::warehouse-missing")).toBe(
      true,
    );
  });

  test("orphan effect phantoms retain their effects", () => {
    const phantoms = buildOrphanEffectPhantoms([
      {
        targetResourceType: "jobs",
        targetId: 123,
        effects: [
          {
            name: "deploy-a",
            action: "create",
            runPageUrl: undefined,
            changes: undefined,
            newState: undefined,
            remoteState: undefined,
          },
        ],
      },
    ]);

    expect(phantoms).toHaveLength(1);
    expect(phantoms[0]).toMatchObject({
      id: "job::123",
      effects: [{ name: "deploy-a", action: "create" }],
    });
  });
});
