import subprocess
import sys
from pathlib import Path

from dagshund.merge import normalize_plan
from dagshund.model import parse_plan

FIXTURE_PLAN = Path(__file__).parent.parent / "fixtures" / "golden" / "agent-app" / "plan.json"


def run_dagshund(*arguments: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, "-m", "dagshund", *arguments],
        capture_output=True,
        text=True,
    )


def test_agent_app_plan_renders_captured_resource_and_run_effects() -> None:
    result = run_dagshund(str(FIXTURE_PLAN))

    assert result.returncode == 0
    assert "apps/retail_assistant" in result.stdout
    assert "experiments/retail_agent_traces" in result.stdout
    assert "postgres_databases/agent_sessions" in result.stdout
    assert "postgres_roles/agent_app" in result.stdout
    assert "schemas/agent_knowledge_schema" in result.stdout
    assert "volumes/agent_knowledge_volume" in result.stdout
    assert "vector_search_endpoints/agent_knowledge_endpoint" in result.stdout
    assert "vector_search_indexes/agent_knowledge_index" in result.stdout
    assert 'job_parameters[\'schema_version\']: "v1" -> "v2"' in result.stdout
    assert "autoscaling_limit_max_cu: 0.5 -> 1" in result.stdout
    assert "runs: ~1 recreate" in result.stdout


def test_agent_app_parsed_plan_preserves_index_binding_and_distinct_job_effects() -> None:
    plan = parse_plan(FIXTURE_PLAN.read_text())
    resources = plan.resources
    index = resources["resources.vector_search_indexes.agent_knowledge_index"]
    app = resources["resources.apps.retail_assistant"]

    assert index.action.value == "create"
    assert index.remote_state is None
    index_state = index.new_state
    assert isinstance(index_state, dict)
    index_value = index_state["value"]
    assert isinstance(index_value, dict)
    assert index_value["delta_sync_index_spec"] == {
        "embedding_source_columns": [{"embedding_model_endpoint_name": "databricks-gte-large-en", "name": "content"}],
        "pipeline_type": "TRIGGERED",
        "source_table": "dagshund.retail_sources.knowledge_source",
    }
    app_state = app.new_state
    assert isinstance(app_state, dict)
    app_value = app_state["value"]
    assert isinstance(app_value, dict)
    bindings = app_value["resources"]
    assert {
        "name": "knowledge_index",
        "uc_securable": {
            "permission": "SELECT",
            "securable_full_name": "dagshund.agent_knowledge.agent_knowledge_index",
            "securable_type": "TABLE",
        },
    } in bindings

    normalized = normalize_plan(plan.resources)
    preparation = normalized["resources.jobs.prepare_agent_knowledge"]
    migration = normalized["resources.jobs.initialize_agent_storage"]
    assert preparation.effects == ()
    assert len(migration.effects) == 1
    assert migration.effects[0].name == "apply_session_migration"
    assert migration.effects[0].changes["job_parameters['schema_version']"].old == "v1"
    assert migration.effects[0].changes["job_parameters['schema_version']"].new == "v2"


def test_agent_app_markdown_renders_migration_parameter_change() -> None:
    result = run_dagshund(str(FIXTURE_PLAN), "--format", "md")

    assert result.returncode == 0
    assert "apply_session_migration" in result.stdout
    assert "schema_version" in result.stdout
    assert "v1" in result.stdout
    assert "v2" in result.stdout


def test_agent_app_detailed_exit_code_reports_captured_changes() -> None:
    result = run_dagshund(str(FIXTURE_PLAN), "--detailed-exitcode")

    assert result.returncode == 2
    assert "initialize_agent_storage" in result.stdout
    assert "re-runs on deploy" in result.stdout
    assert "schema_version" in result.stdout
