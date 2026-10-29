import { describe, expect, test } from "bun:test";
import {
  buildPlanGraphFromPlan,
  buildResourceGraphFromPlan,
} from "../helpers/build-graphs-from-plan.ts";
import { loadFixture } from "../helpers/load-fixture.ts";

const JOB = "resources.jobs.sales_reporting";

describe("sales analytics fixture", () => {
  test("captures task topology, details, and task-level changes", async () => {
    const graph = buildPlanGraphFromPlan(await loadFixture("sales-analytics"));
    const pairs = new Set(graph.edges.map((edge) => `${edge.source}->${edge.target}`));
    const tasks = new Map(
      graph.nodes.filter((node) => node.nodeKind === "task").map((node) => [node.taskKey, node]),
    );

    expect(tasks).toHaveLength(6);
    expect(tasks.get("calculate_daily_revenue")).toMatchObject({
      diffState: "modified",
      resourceState: { sql_task: { parameters: { reporting_window_days: "30" } } },
      changes: {
        "tasks[task_key='calculate_daily_revenue'].sql_task.parameters['reporting_window_days']": {
          action: "update",
          old: "7",
          new: "30",
        },
      },
    });
    expect(tasks.get("calculate_returns")).toMatchObject({
      diffState: "added",
      resourceState: { task_key: "calculate_returns" },
    });
    expect(tasks.get("evaluate_return_rate")).toMatchObject({
      diffState: "added",
      resourceState: {
        alert_task: { alert_id: "1563840667367381", warehouse_id: "9d0afa601cb95187" },
      },
    });
    expect(tasks.get("refresh_sales_dashboard")).toMatchObject({
      diffState: "modified",
      resourceState: {
        depends_on: expect.arrayContaining([{ task_key: "calculate_returns" }]),
      },
      changes: {
        "tasks[task_key='refresh_sales_dashboard'].depends_on[task_key='calculate_returns']": {
          action: "update",
          new: { task_key: "calculate_returns" },
        },
      },
    });
    expect(pairs).toContain(`${JOB}::validate_sales_inputs->${JOB}::calculate_daily_revenue`);
    expect(pairs).toContain(
      `${JOB}::validate_sales_inputs->${JOB}::calculate_regional_performance`,
    );
    expect(pairs).toContain(`${JOB}::validate_sales_inputs->${JOB}::calculate_returns`);
    expect(pairs).toContain(`${JOB}::calculate_daily_revenue->${JOB}::refresh_sales_dashboard`);
    expect(pairs).toContain(
      `${JOB}::calculate_regional_performance->${JOB}::refresh_sales_dashboard`,
    );
    expect(pairs).toContain(`${JOB}::calculate_returns->${JOB}::refresh_sales_dashboard`);
    expect(pairs).toContain(`${JOB}::refresh_sales_dashboard->${JOB}::evaluate_return_rate`);
    expect(pairs).not.toContain(`${JOB}::calculate_returns->${JOB}::evaluate_return_rate`);
  });

  test("captures managed resources, permission and alert changes, and warehouse edges", async () => {
    const plan = await loadFixture("sales-analytics");
    const { nodes, lateralEdges } = buildResourceGraphFromPlan(plan);
    const pairCounts = new Map<string, number>();
    for (const edge of lateralEdges) {
      const pair = `${edge.source}->${edge.target}`;
      pairCounts.set(pair, (pairCounts.get(pair) ?? 0) + 1);
    }

    expect(nodes.filter((node) => node.id === "sql-warehouse::9d0afa601cb95187")).toMatchObject([
      { nodeKind: "phantom" },
    ]);
    expect(nodes.find((node) => node.id === "resources.dashboards.sales_overview")?.diffState).toBe(
      "modified",
    );
    expect(nodes.find((node) => node.id === "resources.alerts.high_return_rate")?.diffState).toBe(
      "modified",
    );
    expect(pairCounts.get(`${JOB}->resources.dashboards.sales_overview`)).toBe(1);
    for (const source of [
      JOB,
      "resources.alerts.high_return_rate",
      "resources.dashboards.sales_overview",
    ]) {
      expect(pairCounts.get(`${source}->sql-warehouse::9d0afa601cb95187`)).toBe(1);
    }
    expect(nodes.filter((node) => node.id.startsWith("sql-warehouse::"))).toHaveLength(1);

    const alert = nodes.find((node) => node.id === "resources.alerts.high_return_rate");
    expect(alert?.changes).toMatchObject({
      "evaluation.threshold.value.double_value": { action: "update", old: 0.05, new: 0.03 },
      "evaluation.notification": {
        action: "update",
        new: { subscriptions: [{ user_email: "user1@example.com" }] },
      },
    });
    const reportingSchema = nodes.find((node) => node.id === "resources.schemas.reporting");
    expect(reportingSchema?.changes?.["grants"]).toMatchObject({
      action: "create",
      new: {
        __embed__: [{ principal: "data_analysts", privileges: ["SELECT", "USE_SCHEMA"] }],
      },
    });
    const dashboard = nodes.find((node) => node.id === "resources.dashboards.sales_overview");
    expect(dashboard?.changes?.["permissions"]).toMatchObject({
      action: "create",
      new: {
        __embed__: [
          { level: "CAN_RUN", group_name: "data_analysts" },
          { level: "CAN_MANAGE", user_name: "user1@example.com" },
        ],
      },
    });
  });
});
