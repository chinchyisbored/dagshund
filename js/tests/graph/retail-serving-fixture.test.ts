import { describe, expect, test } from "bun:test";
import { buildResourceGraphFromPlan } from "../helpers/build-graphs-from-plan.ts";
import { loadFixture } from "../helpers/load-fixture.ts";

const PLAN_PIPELINES = [
  [
    "postgres-synced-pipeline::8422423f-ec0d-4233-bff1-d38ce512a456",
    "resources.postgres_synced_tables.customer_lookup",
  ],
  [
    "postgres-synced-pipeline::9e1f4fcb-4d79-48f7-92e9-8abde1ae536b",
    "resources.postgres_synced_tables.product_lookup",
  ],
] as const;

const edgePair = (source: string, target: string): string => `${source}->${target}`;

describe("retail serving fixture", () => {
  test("shows source, sync, pipeline, and Lakebase semantic details", async () => {
    const plan = await loadFixture("retail-serving");
    const { nodes, lateralEdges } = buildResourceGraphFromPlan(plan);
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const edges = new Set(lateralEdges.map((edge) => edgePair(edge.source, edge.target)));

    expect(byId.get("resources.postgres_endpoints.primary")).toMatchObject({
      diffState: "modified",
      changes: { autoscaling_limit_max_cu: { action: "update", old: 0.5, new: 1 } },
    });
    expect(byId.get("postgres-project::retail-serving")?.changes).toMatchObject({
      permissions: {
        action: "create",
        new: {
          __embed__: expect.arrayContaining([{ level: "CAN_USE", group_name: "data_analysts" }]),
        },
      },
    });
    expect(byId.get("resources.postgres_roles.serving_reader")?.resourceState).toMatchObject({
      status: {
        identity_type: "GROUP",
        postgres_role: "data_analysts",
        auth_method: "LAKEBASE_OAUTH_V1",
      },
    });
    expect(byId.get("resources.postgres_databases.retail_lookup")?.resourceState).toMatchObject({
      status: { postgres_database: "retail_lookup" },
    });

    for (const [name, key, source, primaryKeys] of [
      [
        "customer_lookup",
        "resources.postgres_synced_tables.customer_lookup",
        "dagshund.retail_sources.customer_snapshot",
        ["customer_id"],
      ],
      [
        "product_lookup",
        "resources.postgres_synced_tables.product_lookup",
        "dagshund.retail_sources.product_snapshot",
        ["product_id"],
      ],
      [
        "inventory_lookup",
        "resources.postgres_synced_tables.inventory_lookup",
        "dagshund.retail_sources.inventory_delta",
        ["store_id", "product_id"],
      ],
    ] as const) {
      const sync = byId.get(key);
      const expectedConfig = {
        source_table_full_name: source,
        primary_key_columns: primaryKeys,
        scheduling_policy: "CONTINUOUS",
        postgres_database: "retail_lookup",
        new_pipeline_spec: { storage_catalog: "dagshund", storage_schema: "retail_sync" },
      };
      if (name === "inventory_lookup") {
        expect(sync?.resourceState).toMatchObject(expectedConfig);
      } else {
        expect(sync?.changes).toMatchObject(
          Object.fromEntries(
            Object.entries(expectedConfig).map(([field, value]) => [field, { new: value }]),
          ),
        );
      }
      expect(byId.get(`uc-synced-table::dagshund.retail_sync.${name}`)).toMatchObject({
        nodeKind: "derived",
        ownerResourceKey: key,
      });
      expect(edges.has(edgePair(`uc-synced-table::dagshund.retail_sync.${name}`, key))).toBe(true);
    }

    expect(
      byId.get("resources.postgres_synced_tables.customer_lookup")?.resourceState,
    ).toMatchObject({
      status: {
        detailed_state: "SYNCED_TABLE_PROVISIONING_PIPELINE_RESOURCES",
        unity_catalog_provisioning_state: "ACTIVE",
      },
    });
    expect(byId.get("schema::dagshund.retail_sources")?.nodeKind).toBe("phantom");
    expect(byId.get("source-table::dagshund.retail_sources.inventory_delta")?.nodeKind).toBe(
      "phantom",
    );
    expect(
      nodes.some(
        (node) => node.id === "schema::dagshund.retail_sources" && node.nodeKind !== "phantom",
      ),
    ).toBe(false);
    expect(
      edges.has(
        edgePair(
          "resources.postgres_synced_tables.inventory_lookup",
          "source-table::dagshund.retail_sources.inventory_delta",
        ),
      ),
    ).toBe(true);
    for (const [id, owner] of PLAN_PIPELINES) {
      expect(byId.get(id)).toMatchObject({
        nodeKind: "derived",
        derivedKind: "postgresSyncedTablePipeline",
        ownerResourceKey: owner,
      });
      expect(edges.has(edgePair(id, owner))).toBe(true);
    }
    expect(
      byId.get("postgres-synced-pipeline::resources.postgres_synced_tables.inventory_lookup"),
    ).toMatchObject({
      nodeKind: "derived",
      ownerResourceKey: "resources.postgres_synced_tables.inventory_lookup",
    });
    expect(nodes.filter((node) => node.id.startsWith("postgres-synced-pipeline::"))).toHaveLength(
      3,
    );
  });
});
