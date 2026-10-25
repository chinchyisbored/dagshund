import { describe, expect, test } from "bun:test";
import { buildPlanGraph } from "../../src/graph/build-plan-graph.ts";
import { buildResourceGraph } from "../../src/graph/build-resource-graph.ts";
import { parsePlanJson } from "../../src/parser/parse-plan.ts";
import { preparePlan } from "../../src/preparation/prepare-plan.ts";
import { normalizePlan } from "../../src/utils/normalize-plan.ts";
import cases from "../utils/effective-state-cases.json";

const jobKey = "resources.jobs.pipeline";
const taskId = `${jobKey}::`;

describe("effective resource state in public graph builders", () => {
  test("parsed state vectors select task snapshots consistently in both builders", () => {
    for (const testCase of cases) {
      const entry = {
        ...testCase.entry,
        remote_state: {
          ...(typeof testCase.entry.remote_state === "object" &&
          testCase.entry.remote_state !== null &&
          !Array.isArray(testCase.entry.remote_state)
            ? testCase.entry.remote_state
            : {}),
          tasks: [
            {
              task_key: "stale-task",
              sql_task: { warehouse_id: "stale-warehouse", query: { query_id: "query" } },
            },
          ],
        },
      };
      const parsed = parsePlanJson({ plan: { [jobKey]: entry } });
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) continue;

      const normalized = normalizePlan(parsed.data.plan ?? {});
      const prepared = preparePlan(normalized);
      const planGraph = buildPlanGraph(prepared);
      const resourceGraph = buildResourceGraph(prepared);
      const shouldUseRemote = testCase.origin === "remote";
      expect(planGraph.nodes.some((node) => node.id === `${taskId}stale-task`)).toBe(
        shouldUseRemote,
      );
      expect(resourceGraph.nodes.some((node) => node.id === "sql-warehouse::stale-warehouse")).toBe(
        shouldUseRemote,
      );
      expect(
        resourceGraph.lateralEdges.some((edge) => edge.target === "sql-warehouse::stale-warehouse"),
      ).toBe(shouldUseRemote);
    }
  });
  test("present empty tasks and removed job fields do not restore remote current state", () => {
    const plan = {
      plan: {
        [jobKey]: {
          action: "skip" as const,
          new_state: { value: { tasks: [] } },
          remote_state: {
            name: "stale-name",
            tasks: [{ task_key: "stale-task" }],
          },
        },
      },
    };

    const normalized = normalizePlan(plan.plan);
    const prepared = preparePlan(normalized);
    const planGraph = buildPlanGraph(prepared);
    const resourceGraph = buildResourceGraph(prepared);

    expect(planGraph.nodes.some((node) => node.id === `${taskId}stale-task`)).toBe(false);
    const job = resourceGraph.nodes.find((node) => node.id === jobKey);
    expect(job?.resourceState).toBeUndefined();
    expect(resourceGraph.nodes.some((node) => node.id === `${taskId}stale-task`)).toBe(false);
  });

  test("parsed inputs preserve task relationship state across both public builders", () => {
    const parsed = parsePlanJson({
      plan: {
        [jobKey]: {
          action: "skip",
          new_state: { value: { tasks: [] } },
          remote_state: {
            tasks: [
              {
                task_key: "stale-task",
                sql_task: { warehouse_id: "stale-warehouse", query: { query_id: "query" } },
              },
            ],
          },
        },
      },
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const normalized = normalizePlan(parsed.data.plan ?? {});
    const prepared = preparePlan(normalized);
    const planGraph = buildPlanGraph(prepared);
    const resourceGraph = buildResourceGraph(prepared);

    expect(planGraph.nodes.some((node) => node.id === `${taskId}stale-task`)).toBe(false);
    expect(resourceGraph.nodes.some((node) => node.id === "sql-warehouse::stale-warehouse")).toBe(
      false,
    );
    expect(
      resourceGraph.lateralEdges.some((edge) => edge.target === "sql-warehouse::stale-warehouse"),
    ).toBe(false);
  });

  test("absent new state keeps remote skip tasks, while delete uses remote state", () => {
    const plan = {
      plan: {
        [jobKey]: {
          action: "skip" as const,
          remote_state: { name: "remote-job", tasks: [{ task_key: "remote-task" }] },
        },
      },
    };

    const normalized = normalizePlan(plan.plan);
    const planGraph = buildPlanGraph(preparePlan(normalized));
    expect(planGraph.nodes.some((node) => node.id === `${taskId}remote-task`)).toBe(true);

    const deletedPlan = {
      plan: {
        [jobKey]: {
          action: "delete" as const,
          new_state: { value: { name: "new-job", tasks: [] } },
          remote_state: { name: "deleted-job", tasks: [{ task_key: "deleted-task" }] },
        },
      },
    };
    const normalizedDeleted = normalizePlan(deletedPlan.plan);
    const deleted = buildResourceGraph(preparePlan(normalizedDeleted));
    const deletedJob = deleted.nodes.find((node) => node.id === jobKey);
    expect(deletedJob?.resourceState).toEqual({ name: "deleted-job" });
    const deletedPlanGraph = buildPlanGraph(preparePlan(normalizedDeleted));
    expect(deletedPlanGraph.nodes.some((node) => node.id === `${taskId}deleted-task`)).toBe(true);
  });
});
