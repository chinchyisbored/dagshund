import json
from pathlib import Path

from dagshund.model import ActionType, parse_plan
from dagshund.synced_table_outputs import OutputRelationship, extract_synced_table_outputs

FIXTURE_DIR = Path(__file__).parent.parent / "fixtures" / "golden" / "retail-serving"


def test_retail_serving_capture_preserves_sync_actions_and_managed_outputs() -> None:
    plan = parse_plan((FIXTURE_DIR / "plan.json").read_text())

    assert plan.cli_version == "1.20.0"
    assert plan.resources["resources.postgres_endpoints.primary"].changes["autoscaling_limit_max_cu"].old == 0.5
    assert plan.resources["resources.postgres_endpoints.primary"].changes["autoscaling_limit_max_cu"].new == 1
    assert plan.resources["resources.postgres_synced_tables.inventory_lookup"].action is ActionType.CREATE
    assert plan.resources["resources.postgres_synced_tables.customer_lookup"].action is ActionType.SKIP

    for key, table in (
        ("resources.postgres_synced_tables.customer_lookup", "customer_lookup"),
        ("resources.postgres_synced_tables.product_lookup", "product_lookup"),
        ("resources.postgres_synced_tables.inventory_lookup", "inventory_lookup"),
    ):
        outputs = extract_synced_table_outputs(key, plan.resources[key])
        assert outputs[0].relationship is OutputRelationship.MANAGED
        assert outputs[0].resource_type == "pipeline"
        assert outputs[-1].resource_type == "Unity Catalog registration"
        assert outputs[-1].name == f"dagshund.retail_sync.{table}"

    raw = json.loads((FIXTURE_DIR / "plan.json").read_text())
    customer = raw["plan"]["resources.postgres_synced_tables.customer_lookup"]["remote_state"]["status"]
    assert customer["detailed_state"] == "SYNCED_TABLE_PROVISIONING_PIPELINE_RESOURCES"
    assert customer["unity_catalog_provisioning_state"] == "ACTIVE"
