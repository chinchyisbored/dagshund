import { describe, expect, test } from "bun:test";
import {
  buildPlanGraphFromPlan,
  buildResourceGraphFromPlan,
} from "../helpers/build-graphs-from-plan.ts";
import { loadFixture } from "../helpers/load-fixture.ts";

const JOB = "resources.jobs.workflow";

describe("ML workflow fixture", () => {
  test("exposes changed parameter values and the comparison gate task details", async () => {
    const plan = await loadFixture("ml-workflow");
    const graph = buildPlanGraphFromPlan(plan);
    const taskNodes = new Map(
      graph.nodes.filter((node) => node.nodeKind === "task").map((node) => [node.taskKey, node]),
    );
    const job = plan.plan?.[JOB];
    const builtJob = graph.nodes.find((node) => node.id === JOB);

    expect(job?.changes?.["parameters[name='learning_rate'].default"]).toMatchObject({
      action: "update",
      old: "0.1",
      new: "0.05",
    });
    expect(builtJob?.changes?.["parameters[name='learning_rate'].default"]).toMatchObject({
      action: "update",
      old: "0.1",
      new: "0.05",
    });
    expect(builtJob?.resourceState).toMatchObject({
      parameters: [{ name: "learning_rate", default: "0.05" }],
    });
    expect(taskNodes.get("quality_gate")).toMatchObject({
      diffState: "added",
      resourceState: { condition_task: { op: "GREATER_THAN", left: "1", right: "0" } },
    });
    expect(taskNodes.get("register_promote")?.resourceState).toMatchObject({
      depends_on: [{ task_key: "quality_gate", outcome: "true" }],
    });

    const edges = graph.edges.map(({ source, target, diffState }) => ({
      pair: `${source}->${target}`,
      diffState,
    }));
    expect(edges).toContainEqual({
      pair: `${JOB}::split_data->${JOB}::train_baseline`,
      diffState: "added",
    });
    expect(edges).toContainEqual({
      pair: `${JOB}::train_baseline->${JOB}::evaluate_baseline`,
      diffState: "added",
    });
    expect(edges).toContainEqual({
      pair: `${JOB}::evaluate_baseline->${JOB}::compare_models`,
      diffState: "added",
    });
    expect(edges).toContainEqual({
      pair: `${JOB}::evaluate_candidate->${JOB}::compare_models`,
      diffState: "added",
    });
    expect(edges).toContainEqual({
      pair: `${JOB}::compare_models->${JOB}::quality_gate`,
      diffState: "added",
    });
    expect(edges).toContainEqual({
      pair: `${JOB}::quality_gate->${JOB}::register_promote`,
      diffState: "added",
    });
    expect(edges).toContainEqual({
      pair: `${JOB}::evaluate_candidate->${JOB}::register_promote`,
      diffState: "removed",
    });
  });

  test("shows registered-model, experiment, volume, serving, and access semantics", async () => {
    const plan = await loadFixture("ml-workflow");
    const resourceGraph = buildResourceGraphFromPlan(plan);
    const { nodes, edges, lateralEdges } = resourceGraph;
    const candidate = nodes.find((node) => node.id === "resources.registered_models.candidate");
    const endpoint = nodes.find(
      (node) => node.id === "resources.model_serving_endpoints.candidate_endpoint",
    );
    const volume = nodes.find((node) => node.id === "resources.volumes.training_data");
    const registry = nodes.find((node) => node.id === "resources.schemas.registry");
    const experiments = nodes.filter((node) => node.id.startsWith("resources.experiments."));
    const endpointModelEdges = lateralEdges.filter(
      (edge) => edge.source === "resources.model_serving_endpoints.candidate_endpoint",
    );
    const candidateIdentityNodes = nodes.filter(
      (node) =>
        node.id === "resources.registered_models.candidate" ||
        node.resourceKey === "resources.registered_models.candidate" ||
        node.id === "registered-model::dagshund.ml_registry.ml_candidate",
    );

    expect(candidate?.diffState).toBe("modified");
    expect(candidate?.changes?.["grants"]).toMatchObject({
      action: "create",
      new: { __embed__: [{ principal: "data_analysts", privileges: ["EXECUTE"] }] },
    });
    expect(registry?.changes?.["grants"]).toMatchObject({
      action: "create",
      new: { __embed__: [{ principal: "data_analysts", privileges: ["USE_SCHEMA"] }] },
    });
    expect(endpoint?.diffState).toBe("modified");
    expect(endpoint?.resourceState).toMatchObject({
      config: {
        served_entities: [
          { entity_name: "dagshund.ml_registry.ml_candidate", entity_version: "2" },
        ],
      },
    });
    expect(endpoint?.changes?.["permissions"]).toMatchObject({
      action: "create",
      new: {
        __embed__: expect.arrayContaining([
          { level: "CAN_QUERY", group_name: "data_analysts" },
          { level: "CAN_MANAGE", user_name: "user1@example.com" },
        ]),
      },
    });
    expect(endpointModelEdges).toEqual([
      expect.objectContaining({
        target: "resources.registered_models.candidate",
      }),
    ]);
    expect(candidateIdentityNodes).toHaveLength(1);
    expect(candidateIdentityNodes[0]?.nodeKind).toBe("resource");
    expect(candidate?.nodeKind).toBe("resource");
    expect(volume?.resourceState).toMatchObject({
      full_name: "dagshund.ml_training.training_data",
    });
    expect(experiments).toHaveLength(2);
    expect(experiments.every((node) => node.nodeKind === "resource")).toBe(true);

    const hierarchyEdges = edges.map(({ source, target, diffState }) => ({
      source,
      target,
      diffState,
    }));
    expect(hierarchyEdges).toEqual(
      expect.arrayContaining([
        {
          source: "workspace-root",
          target: "workspace-category::experiments",
          diffState: "unchanged",
        },
        { source: "uc-root", target: "catalog::dagshund", diffState: "unchanged" },
        {
          source: "catalog::dagshund",
          target: "resources.schemas.registry",
          diffState: "unchanged",
        },
        {
          source: "catalog::dagshund",
          target: "resources.schemas.training_schema",
          diffState: "unchanged",
        },
        {
          source: "resources.schemas.registry",
          target: "resources.registered_models.baseline",
          diffState: "unchanged",
        },
        {
          source: "resources.schemas.registry",
          target: "resources.registered_models.candidate",
          diffState: "unchanged",
        },
        {
          source: "resources.schemas.training_schema",
          target: "resources.volumes.training_data",
          diffState: "unchanged",
        },
        {
          source: "workspace-category::experiments",
          target: "resources.experiments.training_experiment",
          diffState: "unchanged",
        },
        {
          source: "workspace-category::experiments",
          target: "resources.experiments.validation",
          diffState: "unchanged",
        },
      ]),
    );
    expect(hierarchyEdges).not.toContainEqual(
      expect.objectContaining({
        source: "resources.volumes.training_data",
        target: "resources.experiments.training_experiment",
      }),
    );

    for (const graphNodes of [nodes, buildPlanGraphFromPlan(plan).nodes]) {
      const bootstrap = graphNodes.find(
        (node) => node.id === "resources.jobs.seed_model_versions_job",
      );
      expect(bootstrap?.diffState).toBe("unchanged");
      if (bootstrap?.nodeKind !== "job" && bootstrap?.nodeKind !== "resource") {
        throw new Error("bootstrap target should be a job resource");
      }
      expect(bootstrap.effects).toMatchObject([
        {
          name: "seed_model_versions_run",
          action: "skip",
          remoteState: { result_state: "SUCCESS" },
        },
      ]);
    }
  });
});
