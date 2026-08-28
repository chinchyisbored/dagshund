import { describe, expect, test } from "bun:test";
import {
  buildDerivedNodeId,
  buildDerivedReferenceIndex,
  entryOwnsPromotedPhantomIdentity,
  extractDerivedNodeBadge,
  extractDerivedNodeLabel,
  extractDerivedNodeRefs,
  extractDerivedPlacement,
  extractDerivedRenderingConvention,
  extractPromotedPhantomKind,
  resolvePromotedPhantomNodeId,
} from "../../src/graph/derived-node-specs.ts";
import type { PlanEntry } from "../../src/types/plan-schema.ts";

describe("derived node specs", () => {
  test("extracts a pipeline event-log table identity from new and remote state", () => {
    const newEntry: PlanEntry = {
      new_state: {
        value: {
          event_log: { catalog: "dagshund", schema: "operations", name: "pipeline_events" },
        },
      },
    };
    const deletedEntry: PlanEntry = {
      action: "delete",
      remote_state: {
        event_log: { catalog: "dagshund", schema: "operations", name: "old_events" },
      },
    };

    expect(extractDerivedNodeRefs("resources.pipelines.ingest", newEntry)).toEqual([
      {
        derivedKind: "pipelineEventLog",
        identity: "dagshund.operations.pipeline_events",
      },
    ]);
    expect(extractDerivedNodeRefs("resources.pipelines.ingest", deletedEntry)).toEqual([
      { derivedKind: "pipelineEventLog", identity: "dagshund.operations.old_events" },
    ]);
  });

  test("rejects incomplete pipeline event-log identities", () => {
    const entry: PlanEntry = {
      new_state: { value: { event_log: { catalog: "dagshund", schema: "operations" } } },
    };

    expect(extractDerivedNodeRefs("resources.pipelines.ingest", entry)).toEqual([]);
  });

  test("extracts a valid UC synced table identity", () => {
    const entry: PlanEntry = {
      new_state: {
        value: {
          source_table_full_name: "source.weather.conditions",
          synced_table_id: "generated.weather.conditions",
        },
      },
    };

    expect(extractDerivedNodeRefs("resources.postgres_synced_tables.conditions", entry)).toEqual([
      { derivedKind: "ucSyncedTable", identity: "generated.weather.conditions" },
      {
        derivedKind: "postgresSyncedTablePipeline",
        identity: "resources.postgres_synced_tables.conditions",
      },
    ]);
  });

  test("does not create a managed pipeline for an existing pipeline reference", () => {
    const newEntry: PlanEntry = {
      new_state: {
        value: {
          existing_pipeline_id: "pipeline-shared",
          synced_table_id: "generated.weather.conditions",
        },
      },
    };
    const remoteEntry: PlanEntry = {
      action: "delete",
      remote_state: {
        existing_pipeline_id: "pipeline-shared",
        synced_table_id: "generated.weather.conditions",
      },
    };

    expect(extractDerivedNodeRefs("resources.postgres_synced_tables.conditions", newEntry)).toEqual(
      [{ derivedKind: "ucSyncedTable", identity: "generated.weather.conditions" }],
    );
    expect(
      extractDerivedNodeRefs("resources.postgres_synced_tables.conditions", remoteEntry),
    ).toEqual([{ derivedKind: "ucSyncedTable", identity: "generated.weather.conditions" }]);
  });

  test("extracts synced_table_id from remote state", () => {
    const entry: PlanEntry = {
      action: "delete",
      remote_state: { synced_table_id: "generated.weather.conditions" },
    };

    expect(extractDerivedNodeRefs("resources.postgres_synced_tables.conditions", entry)).toEqual([
      { derivedKind: "ucSyncedTable", identity: "generated.weather.conditions" },
      {
        derivedKind: "postgresSyncedTablePipeline",
        identity: "resources.postgres_synced_tables.conditions",
      },
    ]);
  });

  test("rejects missing and malformed synced table identities", () => {
    const missing: PlanEntry = { new_state: { value: {} } };
    const malformed: PlanEntry = {
      new_state: { value: { synced_table_id: "weather.conditions" } },
    };

    expect(extractDerivedNodeRefs("resources.postgres_synced_tables.missing", missing)).toEqual([
      {
        derivedKind: "postgresSyncedTablePipeline",
        identity: "resources.postgres_synced_tables.missing",
      },
    ]);
    expect(extractDerivedNodeRefs("resources.postgres_synced_tables.malformed", malformed)).toEqual(
      [
        {
          derivedKind: "postgresSyncedTablePipeline",
          identity: "resources.postgres_synced_tables.malformed",
        },
      ],
    );
  });

  test("ignores synced_table_id on unrelated resources", () => {
    const entry: PlanEntry = {
      new_state: { value: { synced_table_id: "generated.weather.conditions" } },
    };

    expect(extractDerivedNodeRefs("resources.jobs.conditions", entry)).toEqual([]);
  });

  test("registry provides IDs labels badges placement and rendering conventions", () => {
    const eventLogIdentity = "dagshund.operations.pipeline_events";
    expect(buildDerivedNodeId("pipelineEventLog", eventLogIdentity)).toBe(
      `pipeline-event-log::${eventLogIdentity}`,
    );
    expect(extractDerivedNodeBadge("pipelineEventLog")).toBe("event log");
    expect(extractDerivedPlacement("pipelineEventLog")).toEqual({ kind: "ucLeaf" });
    expect(extractPromotedPhantomKind("pipelineEventLog")).toBe("sourceTable");

    expect(buildDerivedNodeId("ucSyncedTable", "generated.weather.conditions")).toBe(
      "uc-synced-table::generated.weather.conditions",
    );
    expect(extractDerivedNodeBadge("ucSyncedTable")).toBe("synced table");
    expect(extractDerivedRenderingConvention("ucSyncedTable")).toBe("resource");
    expect(extractPromotedPhantomKind("ucSyncedTable")).toBe("sourceTable");

    const resourceKey = "resources.postgres_synced_tables.conditions";
    expect(buildDerivedNodeId("postgresSyncedTablePipeline", resourceKey)).toBe(
      `postgres-synced-pipeline::${resourceKey}`,
    );
    expect(extractDerivedNodeLabel("postgresSyncedTablePipeline", resourceKey, resourceKey)).toBe(
      "conditions pipeline",
    );
    expect(extractDerivedNodeBadge("postgresSyncedTablePipeline")).toBe("pipeline");
    expect(extractDerivedPlacement("postgresSyncedTablePipeline")).toEqual({
      kind: "workspace",
      resourceType: "pipelines",
    });
  });

  test("generated pipeline uses concrete new or remote ID and falls back for invalid IDs", () => {
    const resourceKey = "resources.postgres_synced_tables.conditions";
    const newEntry: PlanEntry = { new_state: { value: { pipeline_id: "pipeline-new" } } };
    const remoteEntry: PlanEntry = {
      new_state: { value: {} },
      remote_state: { status: { pipeline_id: "pipeline-remote" } },
    };
    const malformedEntry: PlanEntry = { new_state: { value: { pipeline_id: 42 } } };

    expect(extractDerivedNodeRefs(resourceKey, newEntry)).toContainEqual({
      derivedKind: "postgresSyncedTablePipeline",
      identity: "pipeline-new",
    });
    expect(extractDerivedNodeRefs(resourceKey, remoteEntry)).toContainEqual({
      derivedKind: "postgresSyncedTablePipeline",
      identity: "pipeline-remote",
    });
    expect(extractDerivedNodeRefs(resourceKey, malformedEntry)).toContainEqual({
      derivedKind: "postgresSyncedTablePipeline",
      identity: resourceKey,
    });
  });

  test("generated pipeline references index symbolic and concrete IDs", () => {
    const resourceKey = "resources.postgres_synced_tables.conditions";
    const entries: readonly (readonly [string, PlanEntry])[] = [
      [resourceKey, { new_state: { value: { pipeline_id: "pipeline-new" } } }],
    ];

    const index = buildDerivedReferenceIndex(entries, "pipelines");

    expect(index.get("pipeline-new")).toBe("postgres-synced-pipeline::pipeline-new");
    // biome-ignore lint/suspicious/noTemplateCurlyInString: Databricks interpolation syntax
    expect(index.get("${resources.postgres_synced_tables.conditions.pipeline_id}")).toBe(
      "postgres-synced-pipeline::pipeline-new",
    );
    expect(
      // biome-ignore lint/suspicious/noTemplateCurlyInString: Databricks interpolation syntax
      index.get("${resources.postgres_synced_tables.conditions.status.pipeline_id}"),
    ).toBe("postgres-synced-pipeline::pipeline-new");
  });

  test("detects a promoted phantom identity owned by the same entry", () => {
    const entry: PlanEntry = {
      new_state: { value: { synced_table_id: "generated.weather.conditions" } },
    };

    expect(
      entryOwnsPromotedPhantomIdentity(
        "resources.postgres_synced_tables.conditions",
        entry,
        "sourceTable",
        "generated.weather.conditions",
      ),
    ).toBe(true);
    expect(
      entryOwnsPromotedPhantomIdentity(
        "resources.postgres_synced_tables.conditions",
        entry,
        "registeredModel",
        "generated.weather.conditions",
      ),
    ).toBe(false);
  });

  test("promoted phantom resolution prefers derived and falls back to phantom", () => {
    const identity = "generated.weather.conditions";
    const derivedId = `uc-synced-table::${identity}`;
    const phantomId = `source-table::${identity}`;

    expect(resolvePromotedPhantomNodeId("sourceTable", identity, new Set([phantomId]))).toBe(
      phantomId,
    );
    expect(
      resolvePromotedPhantomNodeId("sourceTable", identity, new Set([phantomId, derivedId])),
    ).toBe(derivedId);
  });
});
