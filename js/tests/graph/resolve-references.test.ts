import { describe, expect, test } from "bun:test";
import { buildReferenceIdentityCatalog } from "../../src/graph/build-reference-identity-catalog.ts";
import { collectOwnedDerivedNodeRefs } from "../../src/graph/derived-node-specs.ts";
import { extractHistoricalStateField } from "../../src/graph/extract-resource-state.ts";
import {
  buildApiIdIndex,
  extractGenieSpaceApiId,
  type ReferenceIndexes,
} from "../../src/graph/reference-specs.ts";
import { resolveReferences } from "../../src/graph/resolve-references.ts";
import { parsePlanJson } from "../../src/parser/parse-plan.ts";
import { preparePlan } from "../../src/preparation/prepare-plan.ts";
import type { PlanEntry } from "../../src/types/plan-schema.ts";
import { normalizePlan } from "../../src/utils/normalize-plan.ts";
import { buildResourceGraphFromPlan } from "../helpers/build-graphs-from-plan.ts";
import referenceOutcomeCases from "./reference-outcome-cases.json";

const entriesFor = (plan: Readonly<Record<string, PlanEntry>>) => Object.entries(plan);

const buildIndexes = (entries: readonly (readonly [string, PlanEntry])[]): ReferenceIndexes => ({
  warehouseIndex: buildApiIdIndex(entries, "sql_warehouses", (entry) =>
    extractHistoricalStateField(entry, "id"),
  ),
  dashboardIndex: new Map(),
  alertIndex: buildApiIdIndex(entries, "alerts", (entry) =>
    extractHistoricalStateField(entry, "id"),
  ),
  pipelineIndex: new Map(),
  genieSpaceIndex: buildApiIdIndex(entries, "genie_spaces", extractGenieSpaceApiId),
  jobIndex: new Map(),
  experimentIndex: new Map(),
  registeredModelFullNameIndex: new Map(),
  jobIdMap: new Map(),
});

describe("resolveReferences", () => {
  test("resolves all conventional warehouse sources from one identity catalog", () => {
    const entries = entriesFor({
      "resources.sql_warehouses.compute": {
        action: "create",
        new_state: { value: { id: "wh-real" } },
      },
      "resources.alerts.alert": {
        action: "create",
        new_state: { value: { warehouse_id: "wh-real" } },
      },
      "resources.dashboards.dashboard": {
        action: "create",
        new_state: { value: { warehouse_id: "wh-real" } },
      },
      "resources.genie_spaces.genie": {
        action: "create",
        new_state: { value: { warehouse_id: "wh-real" } },
      },
      "resources.quality_monitors.monitor": {
        action: "create",
        new_state: { value: { warehouse_id: "wh-real" } },
      },
    });
    const indexes = buildIndexes(entries);
    const preparedPlan = preparePlan(normalizePlan(Object.fromEntries(entries)));
    const identityCatalog = buildReferenceIdentityCatalog(entries, indexes, preparedPlan);
    const ownedDerivedRefs = collectOwnedDerivedNodeRefs(preparedPlan.byResourceKey);

    const references = resolveReferences({
      entries,
      indexes,
      preparedPlan,
      identityCatalog,
      ownedDerivedRefs,
    });

    expect(references.filter((reference) => reference.kind === "resolved")).toHaveLength(4);
    expect(
      references
        .filter((reference) => reference.kind === "resolved")
        .map((reference) => reference.targetNodeId),
    ).toEqual([
      "resources.sql_warehouses.compute",
      "resources.sql_warehouses.compute",
      "resources.sql_warehouses.compute",
      "resources.sql_warehouses.compute",
    ]);
  });

  test("resolves App TABLE name and ID references only to materialized managed indexes", () => {
    const symbolicName = "$" + "{resources.vector_search_indexes.search.name}";
    const symbolicId = "$" + "{resources.vector_search_indexes.search.id}";
    const entries = entriesFor({
      "resources.apps.reader": {
        action: "update",
        new_state: {
          value: {
            resources: [symbolicName, symbolicId].map((fullName, position) => ({
              name: `binding_${position}`,
              uc_securable: { securable_type: "TABLE", securable_full_name: fullName },
            })),
          },
        },
      },
      "resources.apps.invalid": {
        action: "update",
        new_state: {
          value: {
            resources: [
              "$" + "{resources.vector_search_indexes.missing.name}",
              "$" + "{resources.jobs.job.name}",
            ].map((fullName, position) => ({
              name: `binding_${position}`,
              uc_securable: { securable_type: "TABLE", securable_full_name: fullName },
            })),
          },
        },
      },
      "resources.vector_search_indexes.search": {
        action: "create",
        new_state: { value: { name: "main.docs.search_index" } },
      },
    });
    const indexes = buildIndexes(entries);
    const preparedPlan = preparePlan(normalizePlan(Object.fromEntries(entries)));
    const identityCatalog = buildReferenceIdentityCatalog(entries, indexes, preparedPlan);
    const ownedDerivedRefs = collectOwnedDerivedNodeRefs(preparedPlan.byResourceKey);

    const resolutions = resolveReferences({
      entries,
      indexes,
      preparedPlan,
      identityCatalog,
      ownedDerivedRefs,
    });

    expect(
      resolutions.filter(
        (reference) =>
          reference.sourceResourceKey === "resources.apps.reader" && reference.kind === "resolved",
      ),
    ).toEqual([
      {
        kind: "resolved",
        sourceResourceKey: "resources.apps.reader",
        targetNodeId: "resources.vector_search_indexes.search",
        targetResourceKey: "resources.vector_search_indexes.search",
        provenance: "real",
        direction: "entry-to-target",
      },
      {
        kind: "resolved",
        sourceResourceKey: "resources.apps.reader",
        targetNodeId: "resources.vector_search_indexes.search",
        targetResourceKey: "resources.vector_search_indexes.search",
        provenance: "real",
        direction: "entry-to-target",
      },
    ]);
    expect(
      resolutions.filter(
        (reference) =>
          reference.sourceResourceKey === "resources.apps.invalid" &&
          (reference.kind === "resolved" || reference.kind === "phantom"),
      ),
    ).toEqual([]);
  });

  test("resolves table references to derived outputs before node materialization", () => {
    const entries = entriesFor({
      "resources.pipelines.ingest": {
        action: "create",
        new_state: {
          value: { event_log: { catalog: "main", schema: "ops", name: "events" } },
        },
      },
      "resources.quality_monitors.monitor": {
        action: "create",
        new_state: { value: { table_name: "main.ops.events" } },
      },
    });
    const indexes = buildIndexes(entries);
    const preparedPlan = preparePlan(normalizePlan(Object.fromEntries(entries)));
    const identityCatalog = buildReferenceIdentityCatalog(entries, indexes, preparedPlan);
    const ownedDerivedRefs = collectOwnedDerivedNodeRefs(preparedPlan.byResourceKey);

    const resolutions = resolveReferences({
      entries,
      indexes,
      preparedPlan,
      identityCatalog,
      ownedDerivedRefs,
    });

    expect(resolutions).toContainEqual({
      kind: "resolved",
      sourceResourceKey: "resources.quality_monitors.monitor",
      targetNodeId: "pipeline-event-log::main.ops.events",
      provenance: "derived",
      direction: "entry-to-target",
    });
  });

  for (const outcomeCase of referenceOutcomeCases.cases) {
    test(outcomeCase.name, () => {
      const parsed = parsePlanJson({ plan: outcomeCase.entries });
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) throw new Error("reference fixture must parse");
      const entries = entriesFor(parsed.data.plan ?? {});
      const indexes = buildIndexes(entries);
      const preparedPlan = preparePlan(normalizePlan(Object.fromEntries(entries)));
      const identityCatalog = buildReferenceIdentityCatalog(entries, indexes, preparedPlan);
      const ownedDerivedRefs = collectOwnedDerivedNodeRefs(preparedPlan.byResourceKey);
      const resolutions = resolveReferences({
        entries,
        indexes,
        preparedPlan,
        identityCatalog,
        ownedDerivedRefs,
      }).filter(
        (reference) =>
          reference.sourceResourceKey === (outcomeCase.sourceResourceKey ?? "resources.apps.app"),
      );

      for (const expected of outcomeCase.expected) {
        expect(resolutions).toContainEqual(expect.objectContaining(expected));
      }
    });
  }

  test("indexes final hierarchy IDs before graph materialization", () => {
    const entries = entriesFor({
      "resources.catalogs.main": { action: "create", new_state: { value: { name: "main" } } },
      "resources.postgres_projects.demo": {
        action: "create",
        new_state: { value: { project_id: "demo" } },
      },
    });
    const indexes = buildIndexes(entries);

    const catalog = buildReferenceIdentityCatalog(
      entries,
      indexes,
      preparePlan(normalizePlan(Object.fromEntries(entries))),
    );

    expect(catalog.nodeIdByResourceKey.get("resources.catalogs.main")).toBe("catalog::main");
    expect(catalog.nodeIdByResourceKey.get("resources.postgres_projects.demo")).toBe(
      "postgres-project::demo",
    );
    expect(catalog.nodeIdByAlias.get("catalogs:main")).toBe("catalog::main");
    expect(catalog.nodeIdByAlias.get("postgres_projects:demo")).toBe("postgres-project::demo");
  });

  test("matches materialized identities and authoritative pipeline aliases", () => {
    const entries = entriesFor({
      "resources.schemas.public": {
        action: "create",
        new_state: { value: { catalog_name: "main", name: "public" } },
      },
      "resources.postgres_branches.main": {
        action: "create",
        new_state: { value: { parent: "projects/demo", branch_id: "main" } },
      },
      "resources.postgres_databases.db": {
        action: "create",
        new_state: { value: { branch: "projects/demo/branches/main", postgres_database: "db" } },
      },
      "resources.catalogs.stale": {
        action: "update",
        new_state: { value: {} },
        remote_state: { name: "old-name" },
      },
      "resources.pipelines.real": {
        action: "create",
        new_state: { value: { pipeline_id: "generated-1" } },
      },
    });
    const indexes = {
      ...buildIndexes(entries),
      pipelineIndex: new Map([
        ["generated-1", "resources.pipelines.real"],
        [
          "$" + "{resources.postgres_synced_tables.orders.pipeline_id}",
          "postgres-synced-pipeline::generated-1",
        ],
      ]),
    };

    const catalog = buildReferenceIdentityCatalog(
      entries,
      indexes,
      preparePlan(normalizePlan(Object.fromEntries(entries))),
    );

    expect(catalog.nodeIdByResourceKey.get("resources.schemas.public")).toBe(
      "resources.schemas.public",
    );
    expect(catalog.nodeIdByResourceKey.get("resources.postgres_branches.main")).toBe(
      "resources.postgres_branches.main",
    );
    expect(catalog.nodeIdByResourceKey.get("resources.postgres_databases.db")).toBe(
      "resources.postgres_databases.db",
    );
    expect(catalog.nodeIdByResourceKey.get("resources.catalogs.stale")).toBe(
      "resources.catalogs.stale",
    );
    expect(catalog.nodeIdByAlias.get("pipelines:generated-1")).toBe("resources.pipelines.real");
    expect(
      catalog.nodeIdByAlias.get(
        `pipelines:\${resources.postgres_synced_tables.orders.pipeline_id}`,
      ),
    ).toBe("postgres-synced-pipeline::generated-1");
  });

  test("matches current materialized identities for every catalog-tier resource", () => {
    const plan = {
      "resources.database_catalogs.legacy": {
        action: "create",
        new_state: { value: { name: "legacy" } },
      },
      "resources.postgres_catalogs.current": {
        action: "create",
        new_state: { value: { catalog_id: "pg-current" } },
      },
      "resources.postgres_catalogs.stale": {
        action: "update",
        new_state: { value: {} },
        remote_state: { catalog_id: "old-pg" },
      },
    } satisfies Readonly<Record<string, PlanEntry>>;
    const entries = entriesFor(plan);
    const indexes = buildIndexes(entries);
    const identityCatalog = buildReferenceIdentityCatalog(
      entries,
      indexes,
      preparePlan(normalizePlan(Object.fromEntries(entries))),
    );
    const graph = buildResourceGraphFromPlan({ plan });

    expect(identityCatalog.nodeIdByResourceKey.get("resources.database_catalogs.legacy")).toBe(
      "catalog::legacy",
    );
    expect(identityCatalog.nodeIdByResourceKey.get("resources.postgres_catalogs.current")).toBe(
      "catalog::pg-current",
    );
    expect(identityCatalog.nodeIdByResourceKey.get("resources.postgres_catalogs.stale")).toBe(
      "resources.postgres_catalogs.stale",
    );
    expect(graph.nodes.map((node) => node.id)).toContain("catalog::legacy");
    expect(graph.nodes.map((node) => node.id)).toContain("catalog::pg-current");
    expect(graph.nodes.map((node) => node.id)).toContain("resources.postgres_catalogs.stale");
    expect(graph.nodes.map((node) => node.id)).not.toContain("catalog::old-pg");
  });

  test("shares prepared Postgres branch, database, and role identities", () => {
    const entries = entriesFor({
      "resources.postgres_branches.main": {
        action: "create",
        new_state: { value: { parent: "projects/demo", branch_id: "main" } },
      },
      "resources.postgres_databases.db": {
        action: "create",
        new_state: { value: { parent: "projects/demo/branches/main", postgres_database: "db" } },
      },
      "resources.postgres_roles.owner": {
        action: "create",
        new_state: {
          value: {
            parent: "projects/demo/branches/main",
            role_id: "owner",
          },
        },
      },
    });
    const indexes = buildIndexes(entries);
    const preparedPlan = preparePlan(normalizePlan(Object.fromEntries(entries)));
    const catalog = buildReferenceIdentityCatalog(entries, indexes, preparedPlan);

    expect(
      catalog.postgresBranchIdentityByResourceKey.get("resources.postgres_branches.main"),
    ).toBe("demo/main");
    expect(
      catalog.postgresDatabaseIdentityByResourceKey.get("resources.postgres_databases.db"),
    ).toBe("demo/main/db");
    expect(catalog.postgresResourceKeyByIdentity.get("role:demo/main/owner")).toBe(
      "resources.postgres_roles.owner",
    );
  });

  test("resolves Postgres catalog, lineage, and owner targets before materialization", () => {
    const branchRef = "$" + "{resources.postgres_branches.main.id}";
    const entries = entriesFor({
      "resources.postgres_branches.main": {
        action: "create",
        new_state: {
          value: {
            parent: "projects/demo",
            branch_id: "main",
            source_branch: "$" + "{resources.postgres_branches.base.id}",
          },
        },
      },
      "resources.postgres_branches.base": {
        action: "create",
        new_state: { value: { parent: "projects/demo", branch_id: "base" } },
      },
      "resources.postgres_databases.db": {
        action: "create",
        new_state: {
          value: {
            parent: branchRef,
            postgres_database: "app_db",
            role: "$" + "{resources.postgres_roles.owner.id}",
          },
        },
      },
      "resources.postgres_roles.owner": {
        action: "create",
        new_state: {
          value: { parent: "projects/demo/branches/main", role_id: "owner" },
        },
      },
      "resources.postgres_catalogs.catalog": {
        action: "create",
        new_state: {
          value: { branch: branchRef, postgres_database: "app_db", catalog_id: "catalog" },
        },
      },
    });
    const indexes = buildIndexes(entries);
    const preparedPlan = preparePlan(normalizePlan(Object.fromEntries(entries)));
    const identityCatalog = buildReferenceIdentityCatalog(entries, indexes, preparedPlan);
    const references = resolveReferences({
      entries,
      indexes,
      preparedPlan,
      identityCatalog,
      ownedDerivedRefs: collectOwnedDerivedNodeRefs(preparedPlan.byResourceKey),
    });

    expect(references).toContainEqual({
      kind: "resolved",
      sourceResourceKey: "resources.postgres_catalogs.catalog",
      targetNodeId: "resources.postgres_databases.db",
      targetResourceKey: "resources.postgres_databases.db",
      provenance: "real",
      direction: "entry-to-target",
    });
    expect(references).toContainEqual({
      kind: "resolved",
      sourceResourceKey: "resources.postgres_branches.main",
      targetNodeId: "resources.postgres_branches.base",
      targetResourceKey: "resources.postgres_branches.base",
      provenance: "real",
      direction: "entry-to-target",
    });
    expect(references).toContainEqual({
      kind: "resolved",
      sourceResourceKey: "resources.postgres_databases.db",
      targetNodeId: "resources.postgres_roles.owner",
      targetResourceKey: "resources.postgres_roles.owner",
      provenance: "real",
      direction: "entry-to-target",
    });
  });

  test("derived pipeline aliases replace colliding real aliases without mutating inputs", () => {
    const entries = entriesFor({
      "resources.pipelines.real": {
        action: "create",
        new_state: { value: { pipeline_id: "generated-1" } },
      },
      "resources.postgres_synced_tables.orders": {
        action: "create",
        new_state: { value: { pipeline_id: "generated-1" } },
      },
    });
    const indexes = {
      ...buildIndexes(entries),
      pipelineIndex: new Map([["generated-1", "postgres-synced-pipeline::generated-1"]]),
    };

    const inputBefore = JSON.stringify({ entries, pipelineIndex: [...indexes.pipelineIndex] });
    const catalog = buildReferenceIdentityCatalog(
      entries,
      indexes,
      preparePlan(normalizePlan(Object.fromEntries(entries))),
    );

    expect(catalog.nodeIdByAlias.get("pipelines:generated-1")).toBe(
      "postgres-synced-pipeline::generated-1",
    );
    expect(catalog.resourceKeyByAlias.has("pipelines:generated-1")).toBe(false);
    expect(JSON.stringify({ entries, pipelineIndex: [...indexes.pipelineIndex] })).toBe(
      inputBefore,
    );
  });

  test("reports malformed recognized current state as unsupported", () => {
    const entries = entriesFor({
      "resources.alerts.malformed": { action: "create", new_state: { value: 42 } },
    });
    const indexes = buildIndexes(entries);
    const preparedPlan = preparePlan(normalizePlan(Object.fromEntries(entries)));

    const references = resolveReferences({
      entries,
      indexes,
      preparedPlan,
      identityCatalog: buildReferenceIdentityCatalog(entries, indexes, preparedPlan),
      ownedDerivedRefs: collectOwnedDerivedNodeRefs(preparedPlan.byResourceKey),
    });

    expect(references[0]).toMatchObject({
      kind: "unsupported",
      sourceResourceKey: "resources.alerts.malformed",
      diagnostic: { capability: "current-state", reason: "invalid-shape" },
    });
  });

  test("preserves mixed task and workspace descriptor order, optional fields, and inputs", () => {
    const poolReference = "$" + "{resources.instance_pools.worker.id}";
    const entries = entriesFor({
      "resources.jobs.pipeline": {
        action: "create",
        new_state: {
          value: {
            tasks: [
              {
                task_key: "query",
                sql_task: { warehouse_id: "warehouse-id" },
                new_cluster: { instance_pool_id: poolReference },
              },
              {
                task_key: "trigger",
                run_job_task: { job_id: 456 },
                new_cluster: { driver_instance_pool_id: poolReference },
              },
            ],
          },
        },
      },
      "resources.sql_warehouses.compute": {
        action: "create",
        new_state: { value: { id: "warehouse-id" } },
      },
      "resources.instance_pools.worker": {
        action: "create",
        new_state: { value: { instance_pool_id: "pool-id" } },
      },
    });
    const indexes = buildIndexes(entries);
    const preparedPlan = preparePlan(normalizePlan(Object.fromEntries(entries)));
    const identityCatalog = buildReferenceIdentityCatalog(entries, indexes, preparedPlan);
    const ownedDerivedRefs = collectOwnedDerivedNodeRefs(preparedPlan.byResourceKey);
    const inputsBefore = structuredClone({
      entries,
      indexes,
      preparedPlan,
      identityCatalog,
      ownedDerivedRefs,
    });

    const references = resolveReferences({
      entries,
      indexes,
      preparedPlan,
      identityCatalog,
      ownedDerivedRefs,
    });

    expect(references).toStrictEqual([
      { kind: "absent", sourceResourceKey: "resources.jobs.pipeline" },
      {
        kind: "resolved",
        sourceResourceKey: "resources.jobs.pipeline",
        targetNodeId: "resources.sql_warehouses.compute",
        targetResourceKey: "resources.sql_warehouses.compute",
        provenance: "real",
        direction: "entry-to-target",
      },
      {
        kind: "phantom",
        sourceResourceKey: "resources.jobs.pipeline",
        targetNodeId: "job::456",
        resourceKey: "job::456",
        label: "456",
        phantomKind: "job",
        placement: { kind: "workspace-resource", resourceType: "jobs" },
        direction: "entry-to-target",
      },
      {
        kind: "resolved",
        sourceResourceKey: "resources.jobs.pipeline",
        targetNodeId: "resources.instance_pools.worker",
        targetResourceKey: "resources.instance_pools.worker",
        provenance: "real",
        direction: "entry-to-target",
      },
      {
        kind: "resolved",
        sourceResourceKey: "resources.jobs.pipeline",
        targetNodeId: "resources.instance_pools.worker",
        targetResourceKey: "resources.instance_pools.worker",
        provenance: "real",
        direction: "entry-to-target",
      },
      { kind: "absent", sourceResourceKey: "resources.sql_warehouses.compute" },
      { kind: "absent", sourceResourceKey: "resources.instance_pools.worker" },
    ]);
    expect(
      structuredClone({ entries, indexes, preparedPlan, identityCatalog, ownedDerivedRefs }),
    ).toStrictEqual(inputsBefore);
  });

  test("distinguishes absent source fields from unresolved warehouse targets", () => {
    const entries = entriesFor({
      "resources.alerts.without_warehouse": { action: "create", new_state: { value: {} } },
      "resources.alerts.with_phantom": {
        action: "create",
        new_state: { value: { warehouse_id: "missing" } },
      },
    });
    const indexes = buildIndexes(entries);
    const preparedPlan = preparePlan(normalizePlan(Object.fromEntries(entries)));

    const references = resolveReferences({
      entries,
      indexes,
      preparedPlan,
      identityCatalog: buildReferenceIdentityCatalog(entries, indexes, preparedPlan),
      ownedDerivedRefs: collectOwnedDerivedNodeRefs(preparedPlan.byResourceKey),
    });

    expect(references[0]?.kind).toBe("absent");
    expect(references[1]).toMatchObject({
      kind: "phantom",
      targetNodeId: "sql-warehouse::missing",
      resourceKey: "sql-warehouse::missing",
      label: "missing",
      placement: { kind: "workspace-resource", resourceType: "sql_warehouses" },
      direction: "entry-to-target",
    });
  });
});
