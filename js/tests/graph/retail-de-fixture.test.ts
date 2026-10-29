import { describe, expect, test } from "bun:test";
import {
  buildPlanGraphFromPlan,
  buildResourceGraphFromPlan,
} from "../helpers/build-graphs-from-plan.ts";
import { loadFixture } from "../helpers/load-fixture.ts";

describe("retail-de fixture task topology and resource details", () => {
  test("daily orchestration and independent file-arrival paths remain distinct", async () => {
    const plan = await loadFixture("retail-de");
    const { nodes, edges } = buildPlanGraphFromPlan(plan);
    const edgePairs = new Set(edges.map((edge) => `${edge.source}->${edge.target}`));

    expect(edgePairs).toContain(
      "resources.jobs.retail_daily_orchestrator::run_bronze->resources.jobs.retail_bronze_batch",
    );
    expect(edgePairs).toContain(
      "resources.jobs.retail_daily_orchestrator::run_bronze->resources.jobs.retail_daily_orchestrator::run_silver",
    );
    expect(edgePairs).toContain(
      "resources.jobs.retail_daily_orchestrator::run_silver->resources.jobs.retail_daily_orchestrator::run_historization",
    );
    expect(edgePairs).toContain(
      "resources.jobs.retail_daily_orchestrator::run_silver->resources.jobs.retail_silver",
    );
    expect(edgePairs).toContain(
      "resources.jobs.retail_daily_orchestrator::run_historization->resources.jobs.retail_snapshot_history",
    );
    expect(edgePairs).toContain(
      "resources.jobs.retail_bronze_file_arrival::ingest_price_updates->resources.jobs.retail_bronze_file_arrival::run_file_snapshot_history",
    );
    expect(edgePairs).toContain(
      "resources.jobs.retail_bronze_file_arrival::ingest_supplier_updates->resources.jobs.retail_bronze_file_arrival::run_file_snapshot_history",
    );
    expect(edgePairs).toContain(
      "resources.jobs.retail_bronze_file_arrival::run_file_snapshot_history->resources.jobs.retail_file_snapshot_history",
    );
    expect(edgePairs).not.toContain(
      "resources.jobs.retail_daily_orchestrator::run_bronze->resources.jobs.retail_bronze_file_arrival",
    );
    expect(
      nodes.some((node) => node.id === "resources.jobs.retail_snapshot_history::store_history"),
    ).toBe(true);
    expect(edgePairs).toContain(
      "resources.jobs.retail_silver::check_quality_results->resources.jobs.retail_silver::publish_snapshots",
    );
  });

  test("For Each task exposes its input and concurrency changes", async () => {
    const plan = await loadFixture("retail-de");
    const { nodes } = buildPlanGraphFromPlan(plan);
    const bronzeTasks = nodes.filter((node) =>
      node.id.startsWith("resources.jobs.retail_bronze_batch::"),
    );
    const ingest = bronzeTasks.find(
      (node) => node.id === "resources.jobs.retail_bronze_batch::ingest_tables",
    );

    expect(bronzeTasks.map((node) => node.id)).toEqual([
      "resources.jobs.retail_bronze_batch::ingest_tables",
    ]);
    expect(ingest?.diffState).toBe("modified");
    expect(ingest?.resourceState?.["for_each_task"]).toMatchObject({
      task: {
        task_key: "ingest_table",
        notebook_task: {
          notebook_path: expect.stringContaining("/ingest_table"),
          base_parameters: { table: "{{input}}" },
        },
      },
    });
    expect(
      ingest?.changes?.["tasks[task_key='ingest_tables'].for_each_task.concurrency"],
    ).toMatchObject({
      action: "update",
      old: 2,
      new: 5,
    });
    expect(ingest?.changes?.["tasks[task_key='ingest_tables'].for_each_task.inputs"]).toMatchObject(
      {
        action: "update",
        new: '["customers", "products", "orders", "order_items", "stores"]',
      },
    );
  });

  test("store validation and publish changes are represented in task details", async () => {
    const plan = await loadFixture("retail-de");
    const { nodes, edges } = buildPlanGraphFromPlan(plan);
    const edgePairs = new Set(edges.map((edge) => `${edge.source}->${edge.target}`));
    const taskById = new Map(nodes.map((node) => [node.id, node]));
    const storeValidation = taskById.get("resources.jobs.retail_silver::validate_stores");
    const quality = taskById.get("resources.jobs.retail_silver::check_quality_results");
    const publish = taskById.get("resources.jobs.retail_silver::publish_snapshots");

    expect(storeValidation?.diffState).toBe("added");
    expect(edgePairs).toContain(
      "resources.jobs.retail_silver::validate_stores->resources.jobs.retail_silver::check_quality_results",
    );
    expect(quality?.diffState).toBe("modified");
    expect(
      quality?.changes?.[
        "tasks[task_key='check_quality_results'].depends_on[task_key='validate_stores']"
      ],
    ).toMatchObject({ action: "update" });
    expect(publish?.diffState).toBe("modified");
    expect(
      publish?.changes?.[
        "tasks[task_key='publish_snapshots'].notebook_task.base_parameters['mode']"
      ],
    ).toMatchObject({
      action: "update",
      old: "baseline",
      new: "after",
    });
  });

  test("resource graph resolves pipeline tasks and schema grant details", async () => {
    const plan = await loadFixture("retail-de");
    const { nodes, lateralEdges } = buildResourceGraphFromPlan(plan);
    const resourceById = new Map(nodes.map((node) => [node.id, node]));
    const pipelineIds = nodes
      .filter((node) => node.id.startsWith("resources.pipelines."))
      .map((node) => node.id);
    const lateralPairs = new Set(lateralEdges.map((edge) => `${edge.source}->${edge.target}`));
    const goldSchema = resourceById.get("resources.schemas.gold");

    expect(pipelineIds).toHaveLength(5);
    expect(
      nodes
        .filter((node) => node.id.startsWith("resources.pipelines."))
        .every((node) => node.resourceState?.["target"] === "retail_gold"),
    ).toBe(true);
    expect(resourceById.get("resources.pipelines.store_history")?.diffState).toBe("added");
    expect(lateralPairs).toContain(
      "resources.jobs.retail_snapshot_history->resources.pipelines.store_history",
    );
    expect(lateralPairs).toContain(
      "resources.jobs.retail_file_snapshot_history->resources.pipelines.price_history",
    );
    expect(lateralPairs).toContain(
      "resources.jobs.retail_file_snapshot_history->resources.pipelines.supplier_history",
    );
    expect(goldSchema?.diffState).toBe("modified");
    expect(goldSchema?.changes?.["grants"]).toMatchObject({
      action: "create",
      new: {
        securable_type: "schema",
        full_name: "dagshund.retail_gold",
        __embed__: [{ principal: "data_analysts", privileges: ["SELECT", "USE_SCHEMA"] }],
      },
    });
  });
});
