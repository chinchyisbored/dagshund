import json
from pathlib import Path

from dagshund.model import ActionType, parse_plan

REPO_ROOT = Path(__file__).parent.parent
FIXTURE_DIR = REPO_ROOT / "fixtures" / "golden" / "ml-workflow"


def test_ml_workflow_captured_plan_preserves_parameter_and_served_version_diff() -> None:
    plan = parse_plan((FIXTURE_DIR / "plan.json").read_text())

    assert plan.cli_version == "1.20.0"
    workflow = plan.resources["resources.jobs.workflow"]
    learning_rate = workflow.changes["parameters[name='learning_rate'].default"]
    assert (learning_rate.action, learning_rate.old, learning_rate.new) == (
        ActionType.UPDATE,
        "0.1",
        "0.05",
    )
    endpoint = plan.resources["resources.model_serving_endpoints.candidate_endpoint"]
    served_version = endpoint.changes["config.served_entities[0].entity_version"]
    assert (served_version.action, served_version.old, served_version.new) == (
        ActionType.UPDATE,
        "1",
        "2",
    )


def test_ml_workflow_fixture_source_and_capture_keep_nonexecution_limits() -> None:
    before = (FIXTURE_DIR / "before" / "databricks.yaml").read_text()
    after = (FIXTURE_DIR / "after" / "databricks.yaml").read_text()
    capture = json.loads((FIXTURE_DIR / "plan.json").read_text())
    references = capture["plan"]

    assert 'default: "0.1"' in before
    assert 'default: "0.05"' in after
    assert "training_data" in before
    assert "training_data" in after
    assert "ml_baseline" in before
    assert "ml_baseline" in after
    assert "condition_task:" in after
    assert references["resources.jobs.workflow"]["action"] == "update"
    endpoint = references["resources.model_serving_endpoints.candidate_endpoint"]
    assert endpoint["action"] == "update"
    assert endpoint["new_state"]["value"]["config"]["served_entities"][0]["entity_version"] == "2"
