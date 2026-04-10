import { describe, expect, test } from "bun:test";
import { buildPlanGraph } from "../../src/graph/build-plan-graph.ts";
import type { TaskGraphNode } from "../../src/types/graph-types.ts";
import { loadFixture } from "../helpers/load-fixture.ts";

describe("buildPlanGraph", () => {
  test("returns empty graph for empty plan", () => {
    const graph = buildPlanGraph({});
    expect(graph.nodes).toHaveLength(0);
    expect(graph.edges).toHaveLength(0);
  });

  test("returns empty graph when plan record is empty", () => {
    const graph = buildPlanGraph({ plan: {} });
    expect(graph.nodes).toHaveLength(0);
    expect(graph.edges).toHaveLength(0);
  });

  describe("all-create (all creates)", () => {
    test("creates job nodes plus task nodes", async () => {
      const plan = await loadFixture("all-create");
      const graph = buildPlanGraph(plan);

      const jobNodes = graph.nodes.filter((n) => n.nodeKind === "job");
      const taskNodes = graph.nodes.filter((n) => n.nodeKind === "task");

      expect(jobNodes).toHaveLength(2);
      expect(taskNodes).toHaveLength(7);

      const labels = jobNodes.map((n) => n.label).sort();
      expect(labels).toEqual(["data_quality_pipeline", "etl_pipeline"]);
    });

    test("all nodes have diffState 'added' for a create plan", async () => {
      const plan = await loadFixture("all-create");
      const graph = buildPlanGraph(plan);

      for (const node of graph.nodes) {
        expect(node.diffState).toBe("added");
      }
    });

    test("job node has no taskChangeSummary for a create plan (redundant)", async () => {
      const plan = await loadFixture("all-create");
      const graph = buildPlanGraph(plan);

      const jobNode = graph.nodes.find((n) => n.nodeKind === "job");
      expect(jobNode?.taskChangeSummary).toBeUndefined();
    });

    test("creates correct edges from depends_on", async () => {
      const plan = await loadFixture("all-create");
      const graph = buildPlanGraph(plan);
      const rk = "resources.jobs.etl_pipeline";

      const etlEdges = graph.edges.filter(
        (e) => e.source.startsWith(`${rk}::`) && e.target.startsWith(`${rk}::`),
      );
      expect(etlEdges).toHaveLength(2);

      const edgePairs = etlEdges.map((e) => [e.source, e.target]);
      expect(edgePairs).toContainEqual([`${rk}::extract`, `${rk}::transform`]);
      expect(edgePairs).toContainEqual([`${rk}::transform`, `${rk}::load`]);
    });

    test("all edges have diffState 'added' for a create plan", async () => {
      const plan = await loadFixture("all-create");
      const graph = buildPlanGraph(plan);

      for (const edge of graph.edges) {
        expect(edge.diffState).toBe("added");
      }
    });
  });

  describe("mixed-changes (update jobs with task DAGs)", () => {
    test("creates job nodes for both update jobs", async () => {
      const plan = await loadFixture("mixed-changes");
      const graph = buildPlanGraph(plan);

      const jobNodes = graph.nodes.filter((n) => n.nodeKind === "job");
      expect(jobNodes).toHaveLength(2);

      const labels = jobNodes.map((n) => n.label).sort();
      expect(labels).toEqual(["data_quality_pipeline", "etl_pipeline"]);
    });

    test("extracts tasks from new_state for update jobs", async () => {
      const plan = await loadFixture("mixed-changes");
      const graph = buildPlanGraph(plan);

      const etlTasks = graph.nodes.filter(
        (n): n is TaskGraphNode =>
          n.nodeKind === "task" && n.resourceKey === "resources.jobs.etl_pipeline",
      );
      const dqTasks = graph.nodes.filter(
        (n): n is TaskGraphNode =>
          n.nodeKind === "task" && n.resourceKey === "resources.jobs.data_quality_pipeline",
      );

      expect(etlTasks).toHaveLength(6);
      expect(dqTasks).toHaveLength(10);
    });

    test("update job nodes have diffState modified", async () => {
      const plan = await loadFixture("mixed-changes");
      const graph = buildPlanGraph(plan);

      const jobNodes = graph.nodes.filter((n) => n.nodeKind === "job");
      for (const node of jobNodes) {
        expect(node.diffState).toBe("modified");
      }
    });

    test("creates correct intra-job edges from depends_on", async () => {
      const plan = await loadFixture("mixed-changes");
      const graph = buildPlanGraph(plan);
      const rk = "resources.jobs.etl_pipeline";

      const etlEdges = graph.edges.filter(
        (e) => e.source.startsWith(`${rk}::`) && e.target.startsWith(`${rk}::`),
      );
      expect(etlEdges).toHaveLength(5);

      const edgePairs = etlEdges.map((e) => [e.source, e.target]);
      expect(edgePairs).toContainEqual([`${rk}::extract`, `${rk}::transform`]);
      expect(edgePairs).toContainEqual([`${rk}::transform`, `${rk}::load`]);
      expect(edgePairs).toContainEqual([`${rk}::load`, `${rk}::aggregate`]);
      expect(edgePairs).toContainEqual([`${rk}::aggregate`, `${rk}::trigger_quality_check`]);
      expect(edgePairs).toContainEqual([`${rk}::load`, `${rk}::validate`]);
    });

    test("attaches job-level changes (non-task) to job node", async () => {
      const plan = await loadFixture("mixed-changes");
      const graph = buildPlanGraph(plan);

      const jobNode = graph.nodes.find(
        (n) => n.nodeKind === "job" && n.id === "resources.jobs.etl_pipeline",
      );
      expect(jobNode?.changes).toBeDefined();
      if (jobNode?.changes) {
        const changeKeys = Object.keys(jobNode.changes);
        const hasTaskKey = changeKeys.some((k) => k.startsWith("tasks["));
        expect(hasTaskKey).toBe(false);
      }
    });

    test("attaches resourceState to job node without tasks", async () => {
      const plan = await loadFixture("mixed-changes");
      const graph = buildPlanGraph(plan);

      const jobNode = graph.nodes.find(
        (n) => n.nodeKind === "job" && n.id === "resources.jobs.etl_pipeline",
      );
      expect(jobNode?.resourceState).toBeDefined();
      expect(jobNode?.resourceState).toHaveProperty("name", "etl_pipeline");
      expect(jobNode?.resourceState).toHaveProperty("format", "MULTI_TASK");
      expect(jobNode?.resourceState).not.toHaveProperty("tasks");
    });

    test("attaches resourceState to task nodes", async () => {
      const plan = await loadFixture("mixed-changes");
      const graph = buildPlanGraph(plan);

      const extractNode = graph.nodes.find((n) => n.nodeKind === "task" && n.taskKey === "extract");
      expect(extractNode?.resourceState).toBeDefined();
      expect(extractNode?.resourceState).toHaveProperty("task_key", "extract");
    });

    test("update jobs have taskChangeSummary", async () => {
      const plan = await loadFixture("mixed-changes");
      const graph = buildPlanGraph(plan);

      const etlJob = graph.nodes.find((n) => n.nodeKind === "job");
      expect(etlJob?.taskChangeSummary).toBeDefined();
    });

    test("creates cross-job edge from trigger_quality_check to data_quality_pipeline", async () => {
      const plan = await loadFixture("mixed-changes");
      const graph = buildPlanGraph(plan);

      const crossJobEdge = graph.edges.find(
        (e) =>
          e.source === "resources.jobs.etl_pipeline::trigger_quality_check" &&
          e.target === "resources.jobs.data_quality_pipeline",
      );
      expect(crossJobEdge).toBeDefined();
    });
  });

  describe("no-changes (all skip, no new_state)", () => {
    test("extracts tasks from remote_state when new_state is absent", async () => {
      const plan = await loadFixture("no-changes");
      const graph = buildPlanGraph(plan);

      const jobNodes = graph.nodes.filter((n) => n.nodeKind === "job");
      const taskNodes = graph.nodes.filter((n) => n.nodeKind === "task");

      expect(jobNodes).toHaveLength(1);
      expect(taskNodes).toHaveLength(3);
    });

    test("all nodes have diffState unchanged for all-skip plan", async () => {
      const plan = await loadFixture("no-changes");
      const graph = buildPlanGraph(plan);

      for (const node of graph.nodes) {
        expect(node.diffState).toBe("unchanged");
      }
    });

    test("graph is non-empty (original bug: was empty for all-skip plans)", async () => {
      const plan = await loadFixture("no-changes");
      const graph = buildPlanGraph(plan);

      expect(graph.nodes).toHaveLength(4);
      expect(graph.edges).toHaveLength(2);
    });
  });

  describe("deleted task with run_job_task", () => {
    test("creates cross-job edge with 'removed' diffState for deleted run_job_task", () => {
      const plan = {
        plan: {
          "resources.jobs.pipeline_a": {
            action: "update" as const,
            new_state: {
              value: {
                tasks: [{ task_key: "extract" }],
              },
            },
            remote_state: {
              job_id: 100,
              tasks: [
                { task_key: "extract" },
                {
                  task_key: "trigger_b",
                  // biome-ignore lint/suspicious/noTemplateCurlyInString: Databricks bundle interpolation syntax, not a JS template
                  run_job_task: { job_id: "${resources.jobs.pipeline_b.id}" },
                },
              ],
            },
            changes: {
              "tasks[task_key='trigger_b']": {
                action: "delete" as const,
                old: {
                  task_key: "trigger_b",
                  // biome-ignore lint/suspicious/noTemplateCurlyInString: Databricks bundle interpolation syntax, not a JS template
                  run_job_task: { job_id: "${resources.jobs.pipeline_b.id}" },
                },
              },
            },
          },
          "resources.jobs.pipeline_b": {
            action: "skip" as const,
            remote_state: {
              job_id: 200,
              tasks: [{ task_key: "ingest" }],
            },
          },
        },
      };

      const graph = buildPlanGraph(plan);

      const crossJobEdge = graph.edges.find(
        (e) =>
          e.source === "resources.jobs.pipeline_a::trigger_b" &&
          e.target === "resources.jobs.pipeline_b",
      );
      expect(crossJobEdge).toBeDefined();
      expect(crossJobEdge?.diffState).toBe("removed");
    });
  });

  describe("cross-job edges via new_state.vars", () => {
    test("resolves new target job via vars when job_id is 0", () => {
      const plan = {
        plan: {
          "resources.jobs.orchestrator": {
            action: "update" as const,
            new_state: {
              value: {
                tasks: [
                  { task_key: "extract" },
                  { task_key: "trigger_worker", run_job_task: { job_id: 0 } },
                ],
              },
              vars: {
                // biome-ignore lint/suspicious/noTemplateCurlyInString: Databricks bundle interpolation syntax
                "tasks[1].run_job_task.job_id": "${resources.jobs.worker_job.id}",
              },
            },
            remote_state: {
              job_id: 100,
              tasks: [{ task_key: "extract" }],
            },
          },
          "resources.jobs.worker_job": {
            action: "create" as const,
            new_state: {
              value: { tasks: [{ task_key: "run" }] },
            },
          },
        },
      };

      const graph = buildPlanGraph(plan);

      const crossJobEdge = graph.edges.find(
        (e) =>
          e.source === "resources.jobs.orchestrator::trigger_worker" &&
          e.target === "resources.jobs.worker_job",
      );
      expect(crossJobEdge).toBeDefined();
    });

    test("both jobs new: edge has 'added' diffState", () => {
      const plan = {
        plan: {
          "resources.jobs.pipeline_a": {
            action: "create" as const,
            new_state: {
              value: {
                tasks: [{ task_key: "trigger_b", run_job_task: { job_id: 0 } }],
              },
              vars: {
                // biome-ignore lint/suspicious/noTemplateCurlyInString: Databricks bundle interpolation syntax
                "tasks[0].run_job_task.job_id": "${resources.jobs.pipeline_b.id}",
              },
            },
          },
          "resources.jobs.pipeline_b": {
            action: "create" as const,
            new_state: {
              value: { tasks: [{ task_key: "ingest" }] },
            },
          },
        },
      };

      const graph = buildPlanGraph(plan);

      const crossJobEdge = graph.edges.find(
        (e) =>
          e.source === "resources.jobs.pipeline_a::trigger_b" &&
          e.target === "resources.jobs.pipeline_b",
      );
      expect(crossJobEdge).toBeDefined();
      expect(crossJobEdge?.diffState).toBe("added");
    });

    test("numeric lookup wins over vars when target job has remote_state", () => {
      const plan = {
        plan: {
          "resources.jobs.pipeline_a": {
            action: "update" as const,
            new_state: {
              value: {
                tasks: [{ task_key: "trigger_b", run_job_task: { job_id: 200 } }],
              },
              vars: {
                // biome-ignore lint/suspicious/noTemplateCurlyInString: Databricks bundle interpolation syntax
                "tasks[0].run_job_task.job_id": "${resources.jobs.pipeline_b.id}",
              },
            },
            remote_state: { job_id: 100, tasks: [] },
          },
          "resources.jobs.pipeline_b": {
            action: "skip" as const,
            remote_state: {
              job_id: 200,
              tasks: [{ task_key: "ingest" }],
            },
          },
        },
      };

      const graph = buildPlanGraph(plan);

      const crossJobEdge = graph.edges.find(
        (e) =>
          e.source === "resources.jobs.pipeline_a::trigger_b" &&
          e.target === "resources.jobs.pipeline_b",
      );
      expect(crossJobEdge).toBeDefined();
    });

    test("no vars field: job_id 0 produces no edge", () => {
      const plan = {
        plan: {
          "resources.jobs.pipeline_a": {
            action: "update" as const,
            new_state: {
              value: {
                tasks: [{ task_key: "trigger_b", run_job_task: { job_id: 0 } }],
              },
            },
            remote_state: { job_id: 100, tasks: [] },
          },
          "resources.jobs.pipeline_b": {
            action: "create" as const,
            new_state: { value: { tasks: [{ task_key: "ingest" }] } },
          },
        },
      };

      const graph = buildPlanGraph(plan);

      const crossJobEdge = graph.edges.find(
        (e) => e.source === "resources.jobs.pipeline_a::trigger_b",
      );
      expect(crossJobEdge).toBeUndefined();
    });

    test("task_key not in new_state tasks array produces no edge", () => {
      const plan = {
        plan: {
          "resources.jobs.pipeline_a": {
            action: "update" as const,
            new_state: {
              value: {
                tasks: [{ task_key: "extract" }],
              },
              vars: {
                // biome-ignore lint/suspicious/noTemplateCurlyInString: Databricks bundle interpolation syntax
                "tasks[0].run_job_task.job_id": "${resources.jobs.pipeline_b.id}",
              },
            },
            remote_state: {
              job_id: 100,
              tasks: [
                { task_key: "extract" },
                { task_key: "trigger_b", run_job_task: { job_id: 0 } },
              ],
            },
            changes: {
              "tasks[task_key='trigger_b']": {
                action: "delete" as const,
                old: { task_key: "trigger_b", run_job_task: { job_id: 0 } },
              },
            },
          },
        },
      };

      const graph = buildPlanGraph(plan);

      // trigger_b is deleted — it won't be in new_state.value.tasks,
      // so vars resolution cannot find its index
      const crossJobEdge = graph.edges.find(
        (e) => e.source === "resources.jobs.pipeline_a::trigger_b",
      );
      expect(crossJobEdge).toBeUndefined();
    });

    test("non-parseable interpolation in vars produces no edge", () => {
      const plan = {
        plan: {
          "resources.jobs.pipeline_a": {
            action: "create" as const,
            new_state: {
              value: {
                tasks: [{ task_key: "trigger_b", run_job_task: { job_id: 0 } }],
              },
              vars: {
                "tasks[0].run_job_task.job_id": "not-an-interpolation",
              },
            },
          },
        },
      };

      const graph = buildPlanGraph(plan);

      const crossJobEdge = graph.edges.find(
        (e) => e.source === "resources.jobs.pipeline_a::trigger_b",
      );
      expect(crossJobEdge).toBeUndefined();
    });
  });

  describe("sub-resources-plan.json (sub-resource merging)", () => {
    test("creates only one job node, merging sub-resources into parent", async () => {
      const plan = await loadFixture("sub-resources");
      const graph = buildPlanGraph(plan);

      const jobNodes = graph.nodes.filter((n) => n.nodeKind === "job");
      expect(jobNodes).toHaveLength(1);
      expect(jobNodes[0]?.label).toBe("test_job");
    });

    test("does not create nodes for permissions or grants sub-resources", async () => {
      const plan = await loadFixture("sub-resources");
      const graph = buildPlanGraph(plan);

      const nodeIds = graph.nodes.map((n) => n.id);
      expect(nodeIds).not.toContain("resources.jobs.test_job.permissions");
      expect(nodeIds).not.toContain("resources.schemas.analytics.grants");
    });
  });

  describe("complex-plan.json (numeric job_id)", () => {
    test("extracts all tasks from etl_pipeline including run_job_task with numeric job_id", async () => {
      const plan = await loadFixture("mixed-changes");
      const graph = buildPlanGraph(plan);

      const etlTaskNodes = graph.nodes.filter(
        (n): n is TaskGraphNode =>
          n.nodeKind === "task" && n.resourceKey === "resources.jobs.etl_pipeline",
      );
      const taskKeys = etlTaskNodes.map((n) => n.taskKey).sort();
      expect(taskKeys).toEqual([
        "aggregate",
        "extract",
        "load",
        "transform",
        "trigger_quality_check",
        "validate",
      ]);
    });

    test("creates cross-job edge from trigger_quality_check to data_quality_pipeline via numeric job_id", async () => {
      const plan = await loadFixture("mixed-changes");
      const graph = buildPlanGraph(plan);

      const crossJobEdge = graph.edges.find(
        (e) =>
          e.source === "resources.jobs.etl_pipeline::trigger_quality_check" &&
          e.target === "resources.jobs.data_quality_pipeline",
      );
      expect(crossJobEdge).toBeDefined();
      expect(crossJobEdge?.diffState).toBe("added");
    });
  });

  describe("dependency-changes-plan.json (golden fixture — 18 depends_on scenarios)", () => {
    const etl = "resources.jobs.etl_pipeline";
    const data = "resources.jobs.data_pipeline";

    const findEdge = (graph: ReturnType<typeof buildPlanGraph>, source: string, target: string) =>
      graph.edges.find((e) => e.source === source && e.target === target);

    // --- Job 1: conditional scenarios ---

    test("#1 unchanged root: extract has no edges", async () => {
      const graph = buildPlanGraph(await loadFixture("task-dag-rewiring"));
      const extractEdges = graph.edges.filter(
        (e) => e.source === `${etl}::extract` || e.target === `${etl}::extract`,
      );
      const incomingUnchanged = extractEdges.filter(
        (e) => e.target === `${etl}::extract` && e.diffState === "unchanged",
      );
      expect(incomingUnchanged).toHaveLength(0);
    });

    test("#2 unchanged with deps: extract→load edge is unchanged", async () => {
      const graph = buildPlanGraph(await loadFixture("task-dag-rewiring"));
      const edge = findEdge(graph, `${etl}::extract`, `${etl}::load`);
      expect(edge?.diffState).toBe("unchanged");
    });

    test("#6 1→1 swap with outcome removal: full_validation has removed edge from check_row_count and added edge from load", async () => {
      const graph = buildPlanGraph(await loadFixture("task-dag-rewiring"));
      const removed = findEdge(graph, `${etl}::check_row_count`, `${etl}::full_validation`);
      const added = findEdge(graph, `${etl}::load`, `${etl}::full_validation`);
      expect(removed?.diffState).toBe("removed");
      expect(added?.diffState).toBe("added");
    });

    test("#8 2→1 shrink: publish keeps full_validation edge, loses skip_validation edge", async () => {
      const graph = buildPlanGraph(await loadFixture("task-dag-rewiring"));
      const kept = findEdge(graph, `${etl}::full_validation`, `${etl}::publish`);
      const removed = findEdge(graph, `${etl}::skip_validation`, `${etl}::publish`);
      expect(kept?.diffState).toBe("unchanged");
      expect(removed?.diffState).toBe("removed");
    });

    test("#15 removed with deps: check_row_count has removed edge from load", async () => {
      const graph = buildPlanGraph(await loadFixture("task-dag-rewiring"));
      const edge = findEdge(graph, `${etl}::load`, `${etl}::check_row_count`);
      expect(edge?.diffState).toBe("removed");
    });

    test("#15 removed with deps: skip_validation has removed edge from check_row_count", async () => {
      const graph = buildPlanGraph(await loadFixture("task-dag-rewiring"));
      const edge = findEdge(graph, `${etl}::check_row_count`, `${etl}::skip_validation`);
      expect(edge?.diffState).toBe("removed");
    });

    test("#16 removed task was depended on: check_row_count has removed edges to both branches", async () => {
      const graph = buildPlanGraph(await loadFixture("task-dag-rewiring"));
      const toFull = findEdge(graph, `${etl}::check_row_count`, `${etl}::full_validation`);
      const toSkip = findEdge(graph, `${etl}::check_row_count`, `${etl}::skip_validation`);
      expect(toFull?.diffState).toBe("removed");
      expect(toSkip?.diffState).toBe("removed");
    });

    // --- Job 2: non-conditional scenarios ---

    test("#3 0→1 add first dep: monitor gains added edge from ingest", async () => {
      const graph = buildPlanGraph(await loadFixture("task-dag-rewiring"));
      const edge = findEdge(graph, `${data}::ingest`, `${data}::monitor`);
      expect(edge?.diffState).toBe("added");
    });

    test("#4 1→0 remove all deps: normalize loses edge from ingest", async () => {
      const graph = buildPlanGraph(await loadFixture("task-dag-rewiring"));
      const edge = findEdge(graph, `${data}::ingest`, `${data}::normalize`);
      expect(edge?.diffState).toBe("removed");
    });

    test("#5 1→1 swap: clean swaps dep from normalize to ingest", async () => {
      const graph = buildPlanGraph(await loadFixture("task-dag-rewiring"));
      const removed = findEdge(graph, `${data}::normalize`, `${data}::clean`);
      const added = findEdge(graph, `${data}::ingest`, `${data}::clean`);
      expect(removed?.diffState).toBe("removed");
      expect(added?.diffState).toBe("added");
    });

    test("#7 1→2 grow: enrich keeps validate edge, gains clean edge", async () => {
      const graph = buildPlanGraph(await loadFixture("task-dag-rewiring"));
      const kept = findEdge(graph, `${data}::validate`, `${data}::enrich`);
      const added = findEdge(graph, `${data}::clean`, `${data}::enrich`);
      expect(kept?.diffState).toBe("unchanged");
      expect(added?.diffState).toBe("added");
    });

    test("#9 2→2 swap one: process_a keeps clean edge, swaps filter for validate", async () => {
      const graph = buildPlanGraph(await loadFixture("task-dag-rewiring"));
      const kept = findEdge(graph, `${data}::clean`, `${data}::process_a`);
      const removed = findEdge(graph, `${data}::filter`, `${data}::process_a`);
      const added = findEdge(graph, `${data}::validate`, `${data}::process_a`);
      expect(kept?.diffState).toBe("unchanged");
      expect(removed?.diffState).toBe("removed");
      expect(added?.diffState).toBe("added");
    });

    test("#10 2→2 swap both: process_b swaps clean→ingest and filter→validate", async () => {
      const graph = buildPlanGraph(await loadFixture("task-dag-rewiring"));
      const removedClean = findEdge(graph, `${data}::clean`, `${data}::process_b`);
      const removedFilter = findEdge(graph, `${data}::filter`, `${data}::process_b`);
      const addedIngest = findEdge(graph, `${data}::ingest`, `${data}::process_b`);
      const addedValidate = findEdge(graph, `${data}::validate`, `${data}::process_b`);
      expect(removedClean?.diffState).toBe("removed");
      expect(removedFilter?.diffState).toBe("removed");
      expect(addedIngest?.diffState).toBe("added");
      expect(addedValidate?.diffState).toBe("added");
    });

    test("#11 2→2 reorder: combine edges are unchanged (set-based comparison)", async () => {
      const graph = buildPlanGraph(await loadFixture("task-dag-rewiring"));
      const edgeA = findEdge(graph, `${data}::process_a`, `${data}::combine`);
      const edgeB = findEdge(graph, `${data}::process_b`, `${data}::combine`);
      expect(edgeA?.diffState).toBe("unchanged");
      expect(edgeB?.diffState).toBe("unchanged");
    });

    test("#12 new task no deps: audit node exists with added state", async () => {
      const graph = buildPlanGraph(await loadFixture("task-dag-rewiring"));
      const node = graph.nodes.find((n) => n.nodeKind === "task" && n.id === `${data}::audit`);
      expect(node?.diffState).toBe("added");
      const edges = graph.edges.filter(
        (e) => e.source === `${data}::audit` || e.target === `${data}::audit`,
      );
      expect(edges).toHaveLength(0);
    });

    test("#13 new task with deps: clean_v2 has added edge from clean", async () => {
      const graph = buildPlanGraph(await loadFixture("task-dag-rewiring"));
      const edge = findEdge(graph, `${data}::clean`, `${data}::clean_v2`);
      expect(edge?.diffState).toBe("added");
    });

    test("#14 removed task no deps: standby node exists with removed state and no edges", async () => {
      const graph = buildPlanGraph(await loadFixture("task-dag-rewiring"));
      const node = graph.nodes.find((n) => n.nodeKind === "task" && n.id === `${data}::standby`);
      expect(node?.diffState).toBe("removed");
      const ownEdges = graph.edges.filter(
        (e) => e.source === `${data}::standby` && e.target === `${data}::standby`,
      );
      expect(ownEdges).toHaveLength(0);
    });

    test("#17 swap to newly added task: validate swaps dep from clean to clean_v2", async () => {
      const graph = buildPlanGraph(await loadFixture("task-dag-rewiring"));
      const removed = findEdge(graph, `${data}::clean`, `${data}::validate`);
      const added = findEdge(graph, `${data}::clean_v2`, `${data}::validate`);
      expect(removed?.diffState).toBe("removed");
      expect(added?.diffState).toBe("added");
    });

    test("#18 dep on removed task replaced: filter swaps dep from standby to ingest", async () => {
      const graph = buildPlanGraph(await loadFixture("task-dag-rewiring"));
      const removed = findEdge(graph, `${data}::standby`, `${data}::filter`);
      const added = findEdge(graph, `${data}::ingest`, `${data}::filter`);
      expect(removed?.diffState).toBe("removed");
      expect(added?.diffState).toBe("added");
    });

    test("#2 unchanged with deps (data_pipeline): output→combine edge unchanged", async () => {
      const graph = buildPlanGraph(await loadFixture("task-dag-rewiring"));
      const edge = findEdge(graph, `${data}::combine`, `${data}::output`);
      expect(edge?.diffState).toBe("unchanged");
    });
  });

  describe("run_job_task job_id annotation", () => {
    const findTaskNode = (graph: ReturnType<typeof buildPlanGraph>, taskKey: string) =>
      graph.nodes.find((n): n is TaskGraphNode => n.nodeKind === "task" && n.taskKey === taskKey);

    const runJobTaskJobId = (node: TaskGraphNode | undefined) => {
      const rjt = node?.resourceState?.["run_job_task"];
      return typeof rjt === "object" && rjt !== null && "job_id" in rjt ? rjt.job_id : undefined;
    };

    test("job_id 0 with vars is annotated with target name", () => {
      const plan = {
        plan: {
          "resources.jobs.orchestrator": {
            action: "create" as const,
            new_state: {
              value: {
                tasks: [
                  { task_key: "extract" },
                  { task_key: "trigger_worker", run_job_task: { job_id: 0 } },
                ],
              },
              vars: {
                // biome-ignore lint/suspicious/noTemplateCurlyInString: Databricks bundle interpolation syntax
                "tasks[1].run_job_task.job_id": "${resources.jobs.worker_job.id}",
              },
            },
          },
          "resources.jobs.worker_job": {
            action: "create" as const,
            new_state: { value: { tasks: [{ task_key: "run" }] } },
          },
        },
      };

      const graph = buildPlanGraph(plan);
      const node = findTaskNode(graph, "trigger_worker");
      expect(runJobTaskJobId(node)).toBe("0 (worker_job)");
    });

    test("numeric job_id with remote_state lookup is annotated", () => {
      const plan = {
        plan: {
          "resources.jobs.pipeline_a": {
            action: "update" as const,
            new_state: {
              value: {
                tasks: [{ task_key: "trigger_b", run_job_task: { job_id: 200 } }],
              },
              vars: {
                // biome-ignore lint/suspicious/noTemplateCurlyInString: Databricks bundle interpolation syntax
                "tasks[0].run_job_task.job_id": "${resources.jobs.pipeline_b.id}",
              },
            },
            remote_state: { job_id: 100, tasks: [] },
          },
          "resources.jobs.pipeline_b": {
            action: "skip" as const,
            remote_state: { job_id: 200, tasks: [{ task_key: "ingest" }] },
          },
        },
      };

      const graph = buildPlanGraph(plan);
      const node = findTaskNode(graph, "trigger_b");
      expect(runJobTaskJobId(node)).toBe("200 (pipeline_b)");
    });

    test("string interpolation job_id is annotated", () => {
      const plan = {
        plan: {
          "resources.jobs.pipeline_a": {
            action: "update" as const,
            new_state: {
              value: {
                tasks: [
                  {
                    task_key: "trigger_b",
                    // biome-ignore lint/suspicious/noTemplateCurlyInString: Databricks bundle interpolation syntax
                    run_job_task: { job_id: "${resources.jobs.pipeline_b.id}" },
                  },
                ],
              },
            },
            remote_state: { job_id: 100, tasks: [] },
          },
          "resources.jobs.pipeline_b": {
            action: "skip" as const,
            remote_state: { job_id: 200, tasks: [{ task_key: "ingest" }] },
          },
        },
      };

      const graph = buildPlanGraph(plan);
      const node = findTaskNode(graph, "trigger_b");
      // biome-ignore lint/suspicious/noTemplateCurlyInString: Databricks bundle interpolation syntax
      expect(runJobTaskJobId(node)).toBe("${resources.jobs.pipeline_b.id} (pipeline_b)");
    });

    test("unresolvable job_id 0 (no vars) stays as raw number", () => {
      const plan = {
        plan: {
          "resources.jobs.pipeline_a": {
            action: "create" as const,
            new_state: {
              value: {
                tasks: [{ task_key: "trigger_b", run_job_task: { job_id: 0 } }],
              },
            },
          },
        },
      };

      const graph = buildPlanGraph(plan);
      const node = findTaskNode(graph, "trigger_b");
      expect(runJobTaskJobId(node)).toBe(0);
    });

    test("task without run_job_task is unchanged", () => {
      const plan = {
        plan: {
          "resources.jobs.orchestrator": {
            action: "create" as const,
            new_state: {
              value: {
                tasks: [{ task_key: "extract", notebook_task: { notebook_path: "/foo" } }],
              },
            },
          },
        },
      };

      const graph = buildPlanGraph(plan);
      const node = findTaskNode(graph, "extract");
      expect(node?.resourceState?.["run_job_task"]).toBeUndefined();
      expect(node?.resourceState?.["notebook_task"]).toEqual({ notebook_path: "/foo" });
    });

    test("other run_job_task fields are preserved", () => {
      const plan = {
        plan: {
          "resources.jobs.orchestrator": {
            action: "create" as const,
            new_state: {
              value: {
                tasks: [
                  {
                    task_key: "trigger_worker",
                    run_job_task: {
                      job_id: 0,
                      job_parameters: { env: "prod" },
                    },
                  },
                ],
              },
              vars: {
                // biome-ignore lint/suspicious/noTemplateCurlyInString: Databricks bundle interpolation syntax
                "tasks[0].run_job_task.job_id": "${resources.jobs.worker_job.id}",
              },
            },
          },
          "resources.jobs.worker_job": {
            action: "create" as const,
            new_state: { value: { tasks: [{ task_key: "run" }] } },
          },
        },
      };

      const graph = buildPlanGraph(plan);
      const node = findTaskNode(graph, "trigger_worker");
      // resourceState values are opaque `unknown` — cast to access individual fields
      const rjt = node?.resourceState?.["run_job_task"] as Record<string, unknown>;
      expect(rjt["job_id"]).toBe("0 (worker_job)");
      expect(rjt["job_parameters"]).toEqual({ env: "prod" });
    });

    test("deleted task with run_job_task: numeric lookup still annotates", () => {
      const plan = {
        plan: {
          "resources.jobs.orchestrator": {
            action: "update" as const,
            new_state: {
              value: { tasks: [{ task_key: "extract" }] },
            },
            remote_state: {
              job_id: 100,
              tasks: [
                { task_key: "extract" },
                { task_key: "trigger_old", run_job_task: { job_id: 200 } },
              ],
            },
            changes: {
              "tasks[task_key='trigger_old']": {
                action: "delete" as const,
                old: { task_key: "trigger_old", run_job_task: { job_id: 200 } },
              },
            },
          },
          "resources.jobs.old_target": {
            action: "skip" as const,
            remote_state: { job_id: 200, tasks: [{ task_key: "work" }] },
          },
        },
      };

      const graph = buildPlanGraph(plan);
      const node = findTaskNode(graph, "trigger_old");
      // Deleted tasks resolve via jobIdMap (numeric lookup), not vars.
      // The target job still exists in the plan, so annotation works.
      expect(runJobTaskJobId(node)).toBe("200 (old_target)");
    });

    test("deleted task with job_id 0 and no vars is not annotated", () => {
      const plan = {
        plan: {
          "resources.jobs.orchestrator": {
            action: "update" as const,
            new_state: {
              value: { tasks: [{ task_key: "extract" }] },
            },
            remote_state: {
              job_id: 100,
              tasks: [
                { task_key: "extract" },
                { task_key: "trigger_old", run_job_task: { job_id: 0 } },
              ],
            },
            changes: {
              "tasks[task_key='trigger_old']": {
                action: "delete" as const,
                old: { task_key: "trigger_old", run_job_task: { job_id: 0 } },
              },
            },
          },
        },
      };

      const graph = buildPlanGraph(plan);
      const node = findTaskNode(graph, "trigger_old");
      // job_id=0 with no vars and no jobIdMap match: unresolvable, stays raw.
      expect(runJobTaskJobId(node)).toBe(0);
    });
  });
});
