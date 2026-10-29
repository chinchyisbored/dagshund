import { describe, expect, test } from "bun:test";
import { preparePlan } from "../../src/preparation/prepare-plan.ts";
import type { GraphNode } from "../../src/types/graph-types.ts";
import { normalizePlan } from "../../src/utils/normalize-plan.ts";
import {
  buildPlanGraphFromPlan,
  buildResourceGraphFromPlan,
} from "../helpers/build-graphs-from-plan.ts";
import { loadFixture } from "../helpers/load-fixture.ts";

const findNode = (nodes: readonly GraphNode[], id: string): GraphNode | undefined =>
  nodes.find((node) => node.id === id);

describe("Agent App captured fixture", () => {
  test("captures App resource references and the owned Postgres hierarchy", async () => {
    const plan = await loadFixture("agent-app");
    const graph = buildResourceGraphFromPlan(plan);
    const app = findNode(graph.nodes, "resources.apps.retail_assistant");
    const database = findNode(graph.nodes, "resources.postgres_databases.agent_sessions");
    const role = findNode(graph.nodes, "resources.postgres_roles.agent_app");
    const endpoint = graph.nodes.find(
      (node) => node.id === "serving-endpoint::databricks-gpt-oss-20b",
    );
    const edgePairs = graph.edges.map(({ source, target }) => `${source}->${target}`);
    const knowledgeSchema = findNode(graph.nodes, "resources.schemas.agent_knowledge_schema");
    const knowledgeVolume = findNode(graph.nodes, "resources.volumes.agent_knowledge_volume");
    const knowledgeIndex = findNode(
      graph.nodes,
      "resources.vector_search_indexes.agent_knowledge_index",
    );
    const sourceTable = findNode(
      graph.nodes,
      "source-table::dagshund.retail_sources.knowledge_source",
    );
    const embeddingEndpoint = findNode(graph.nodes, "serving-endpoint::databricks-gte-large-en");
    const searchEndpoint = findNode(
      graph.nodes,
      "resources.vector_search_endpoints.agent_knowledge_endpoint",
    );

    expect(knowledgeSchema?.nodeKind).toBe("resource");
    expect(knowledgeVolume?.nodeKind).toBe("resource");
    expect(knowledgeIndex?.nodeKind).toBe("resource");
    expect(knowledgeIndex?.diffState).toBe("added");
    expect(searchEndpoint?.nodeKind).toBe("resource");
    expect(sourceTable?.nodeKind).toBe("phantom");
    expect(embeddingEndpoint?.nodeKind).toBe("phantom");
    expect(knowledgeSchema?.resourceState).toMatchObject({
      full_name: "dagshund.agent_knowledge",
      name: "agent_knowledge",
    });
    expect(knowledgeVolume?.resourceState).toMatchObject({
      full_name: "dagshund.agent_knowledge.agent_knowledge_volume",
      volume_type: "MANAGED",
    });
    expect(knowledgeIndex?.resourceState).toMatchObject({
      delta_sync_index_spec: {
        embedding_source_columns: [
          { embedding_model_endpoint_name: "databricks-gte-large-en", name: "content" },
        ],
        pipeline_type: "TRIGGERED",
        source_table: "dagshund.retail_sources.knowledge_source",
      },
      endpoint_name: "dagshund-agent-knowledge-search",
      index_type: "DELTA_SYNC",
      name: "dagshund.agent_knowledge.agent_knowledge_index",
      primary_key: "document_id",
    });
    expect(app?.diffState).toBe("modified");
    expect(app?.resourceState).toMatchObject({
      name: "retail-assistant",
      resources: [
        {
          name: "session_database",
          postgres: {
            branch: "projects/retail-agent/branches/production",
            database: "projects/retail-agent/branches/production/databases/agent-sessions",
            permission: "CAN_CONNECT_AND_CREATE",
          },
        },
        {
          name: "trace_experiment",
          experiment: { experiment_id: "10668152518462", permission: "CAN_EDIT" },
        },
        {
          name: "chat_endpoint",
          serving_endpoint: { name: "databricks-gpt-oss-20b", permission: "CAN_QUERY" },
        },
        {
          name: "knowledge_volume",
          uc_securable: {
            permission: "READ_VOLUME",
            securable_full_name: "dagshund.agent_knowledge.agent_knowledge_volume",
            securable_type: "VOLUME",
          },
        },
        {
          name: "knowledge_index",
          uc_securable: {
            permission: "SELECT",
            securable_full_name: "dagshund.agent_knowledge.agent_knowledge_index",
            securable_type: "TABLE",
          },
        },
      ],
    });
    expect(app?.changes?.["resources"]).toMatchObject({
      action: "update",
      old: [
        { name: "session_database" },
        { name: "trace_experiment" },
        { name: "knowledge_volume" },
      ],
      new: [
        { name: "session_database" },
        { name: "trace_experiment" },
        { name: "chat_endpoint" },
        { name: "knowledge_volume" },
        { name: "knowledge_index" },
      ],
    });
    expect(database?.resourceState).toMatchObject({
      name: "projects/retail-agent/branches/production/databases/agent-sessions",
      status: { role: "projects/retail-agent/branches/production/roles/data-analysts" },
    });
    expect(role?.resourceState).toMatchObject({
      role_id: "data-analysts",
      status: {
        auth_method: "LAKEBASE_OAUTH_V1",
        identity_type: "GROUP",
        postgres_role: "data_analysts",
      },
    });
    expect(edgePairs).toContain(
      "resources.postgres_branches.production->resources.postgres_databases.agent_sessions",
    );
    expect(edgePairs).toContain(
      "resources.postgres_branches.production->resources.postgres_roles.agent_app",
    );
    expect(endpoint?.nodeKind).toBe("phantom");
    expect(edgePairs).toContain("catalog::dagshund->resources.schemas.agent_knowledge_schema");
    expect(edgePairs).toContain(
      "resources.schemas.agent_knowledge_schema->resources.volumes.agent_knowledge_volume",
    );
    expect(edgePairs).toContain(
      "resources.schemas.agent_knowledge_schema->resources.vector_search_indexes.agent_knowledge_index",
    );
    expect(edgePairs).toContain("workspace-category::jobs->resources.jobs.prepare_agent_knowledge");

    const lateralPairs = graph.lateralEdges.map(({ source, target }) => `${source}->${target}`);
    expect(lateralPairs).toContain(
      "resources.apps.retail_assistant->resources.volumes.agent_knowledge_volume",
    );
    expect(lateralPairs).toContain(
      "resources.apps.retail_assistant->resources.experiments.retail_agent_traces",
    );
    expect(lateralPairs).toContain(
      "resources.apps.retail_assistant->serving-endpoint::databricks-gpt-oss-20b",
    );
    expect(lateralPairs).toContain(
      "resources.apps.retail_assistant->source-table::dagshund.agent_knowledge.agent_knowledge_index",
    );
    expect(lateralPairs).toContain(
      "resources.vector_search_indexes.agent_knowledge_index->resources.vector_search_endpoints.agent_knowledge_endpoint",
    );
    expect(lateralPairs).toContain(
      "resources.vector_search_indexes.agent_knowledge_index->source-table::dagshund.retail_sources.knowledge_source",
    );
    expect(lateralPairs).toContain(
      "resources.vector_search_indexes.agent_knowledge_index->serving-endpoint::databricks-gte-large-en",
    );
    expect(new Set(lateralPairs).size).toBe(lateralPairs.length);

    const prepared = preparePlan(normalizePlan(plan.plan ?? {}));
    expect(
      prepared.byResourceKey.get("resources.vector_search_indexes.agent_knowledge_index")
        ?.vectorIndex,
    ).toEqual({
      status: "supported",
      value: {
        endpointName: "dagshund-agent-knowledge-search",
        sourceTable: "dagshund.retail_sources.knowledge_source",
        embeddingEndpoints: ["databricks-gte-large-en"],
      },
    });
  });

  test("preserves unchanged job and tasks while exposing the captured migration run", async () => {
    const plan = await loadFixture("agent-app");
    const graph = buildPlanGraphFromPlan(plan);
    const job = findNode(graph.nodes, "resources.jobs.initialize_agent_storage");
    const preparationJob = findNode(graph.nodes, "resources.jobs.prepare_agent_knowledge");
    const preparationTaskIds = [
      "resources.jobs.prepare_agent_knowledge::inspect_source",
      "resources.jobs.prepare_agent_knowledge::prepare_documents",
      "resources.jobs.prepare_agent_knowledge::verify_preparation",
    ];
    const taskIds = [
      "resources.jobs.initialize_agent_storage::check_database",
      "resources.jobs.initialize_agent_storage::apply_session_schema",
      "resources.jobs.initialize_agent_storage::verify_session_storage",
    ];

    expect(preparationJob?.diffState).toBe("unchanged");
    expect(preparationJob?.nodeKind).toBe("job");
    if (preparationJob?.nodeKind !== "job") throw new Error("preparation job not found");
    expect(preparationJob.effects).toBeUndefined();
    for (const taskId of preparationTaskIds) {
      expect(findNode(graph.nodes, taskId)?.diffState).toBe("unchanged");
    }
    const planEdgePairs = graph.edges.map(({ source, target }) => `${source}->${target}`);
    expect(planEdgePairs).toContain(`${preparationTaskIds[0]}->${preparationTaskIds[1]}`);
    expect(planEdgePairs).toContain(`${preparationTaskIds[1]}->${preparationTaskIds[2]}`);

    expect(job?.diffState).toBe("unchanged");
    expect(job?.nodeKind).toBe("job");
    if (job?.nodeKind !== "job") throw new Error("fixture job not found");
    expect(job.effects).toMatchObject([
      {
        name: "apply_session_migration",
        action: "recreate",
        changes: {
          "job_parameters['schema_version']": { old: "v1", new: "v2" },
          result_state: { new: "SUCCESS" },
        },
        remoteState: {
          run_id: 885521012460117,
          state: { result_state: "SUCCESS" },
        },
      },
    ]);
    for (const taskId of taskIds) {
      expect(findNode(graph.nodes, taskId)?.diffState).toBe("unchanged");
    }
    expect(graph.edges.map(({ source, target }) => `${source}->${target}`)).toContain(
      `${taskIds[0]}->${taskIds[1]}`,
    );
    expect(graph.edges.map(({ source, target }) => `${source}->${target}`)).toContain(
      `${taskIds[1]}->${taskIds[2]}`,
    );
  });
});
