import json
from pathlib import Path

from dagshund.model import ActionType, parse_plan

REPO_ROOT = Path(__file__).parent.parent
FIXTURE_DIR = REPO_ROOT / "fixtures" / "golden" / "sales-analytics"


def test_sales_analytics_source_captures_paused_schedule_and_change_story() -> None:
    before = (FIXTURE_DIR / "before" / "databricks.yaml").read_text()
    after = (FIXTURE_DIR / "after" / "databricks.yaml").read_text()

    for configuration in (before, after):
        assert 'quartz_cron_expression: "0 0 8 ? * MON-FRI"' in configuration
        assert 'quartz_cron_schedule: "0 0 8 ? * MON-FRI"' in configuration
        assert configuration.count("pause_status: PAUSED") == 2
        assert "${var.warehouse_id}" in configuration

    assert "double_value: 0.05" in before
    assert "double_value: 0.03" in after
    assert "user_email: ${workspace.current_user.userName}" in after
    assert "user_email:" not in before
    assert "task_key: calculate_returns" not in before
    assert "task_key: calculate_returns" in after
    assert "task_key: evaluate_return_rate" in after
    assert "task_key: refresh_sales_dashboard" in after


def test_sales_analytics_validation_sources_are_databricks_notebooks() -> None:
    for state in ("before", "after"):
        notebook = FIXTURE_DIR / state / "validate_sales_inputs.py"

        assert notebook.read_text().splitlines()[0] == "# Databricks notebook source"


def test_sales_analytics_revenue_task_configures_reporting_window() -> None:
    before = (FIXTURE_DIR / "before" / "databricks.yaml").read_text()
    after = (FIXTURE_DIR / "after" / "databricks.yaml").read_text()
    before_sql = (FIXTURE_DIR / "before" / "daily_revenue.sql").read_text()
    after_sql = (FIXTURE_DIR / "after" / "daily_revenue.sql").read_text()

    assert 'reporting_window_days: "7"' in before
    assert 'reporting_window_days: "30"' in after
    assert ":reporting_window_days" in before_sql
    assert ":reporting_window_days" in after_sql


def test_sales_analytics_dashboard_uses_native_dataset_bindings() -> None:
    for state in ("before", "after"):
        configuration = (FIXTURE_DIR / state / "databricks.yaml").read_text()
        dashboard = json.loads((FIXTURE_DIR / state / "sales_overview.lvdash.json").read_text())

        assert "dataset_catalog: ${var.catalog_name}" in configuration
        assert "dataset_schema: ${resources.schemas.reporting.name}" in configuration
        assert all("${" not in dataset["query"] for dataset in dashboard["datasets"])
        assert all(f"FROM {dataset['name']}" in dataset["query"] for dataset in dashboard["datasets"])

    before = json.loads((FIXTURE_DIR / "before" / "sales_overview.lvdash.json").read_text())
    after = json.loads((FIXTURE_DIR / "after" / "sales_overview.lvdash.json").read_text())

    assert [dataset["name"] for dataset in before["datasets"]] == ["daily_sales"]
    assert [dataset["name"] for dataset in after["datasets"]] == [
        "daily_sales",
        "daily_returns",
    ]


def test_sales_analytics_captured_plan_parses_resource_and_access_changes() -> None:
    plan = parse_plan((FIXTURE_DIR / "plan.json").read_text())

    assert plan.cli_version == "1.20.0"
    revenue = plan.resources["resources.jobs.sales_reporting"].changes[
        "tasks[task_key='calculate_daily_revenue'].sql_task.parameters['reporting_window_days']"
    ]
    assert (revenue.action, revenue.old, revenue.new) == (ActionType.UPDATE, "7", "30")

    alert = plan.resources["resources.alerts.high_return_rate"]
    threshold = alert.changes["evaluation.threshold.value.double_value"]
    assert (threshold.action, threshold.old, threshold.new) == (ActionType.UPDATE, 0.05, 0.03)
    subscription = alert.changes["evaluation.notification"].new
    assert subscription == {"subscriptions": [{"user_email": "user1@example.com"}]}

    returns = plan.resources["resources.jobs.sales_reporting"].changes["tasks[task_key='calculate_returns']"]
    evaluation = plan.resources["resources.jobs.sales_reporting"].changes["tasks[task_key='evaluate_return_rate']"]
    fan_in = plan.resources["resources.jobs.sales_reporting"].changes[
        "tasks[task_key='refresh_sales_dashboard'].depends_on[task_key='calculate_returns']"
    ]
    assert returns.action is ActionType.UPDATE
    assert isinstance(evaluation.new, dict)
    alert_task = evaluation.new["alert_task"]
    assert isinstance(alert_task, dict)
    assert alert_task["alert_id"] == "1563840667367381"
    assert fan_in.new == {"task_key": "calculate_returns"}

    reporting_grants = plan.resources["resources.schemas.reporting.grants"]
    assert reporting_grants.action is ActionType.CREATE
    assert isinstance(reporting_grants.new_state, dict)
    reporting = reporting_grants.new_state["value"]
    assert isinstance(reporting, dict)
    assert reporting["__embed__"] == [{"principal": "data_analysts", "privileges": ["SELECT", "USE_SCHEMA"]}]
    dashboard_permissions = plan.resources["resources.dashboards.sales_overview.permissions"]
    assert dashboard_permissions.action is ActionType.CREATE
    assert isinstance(dashboard_permissions.new_state, dict)
    permissions = dashboard_permissions.new_state["value"]
    assert isinstance(permissions, dict)
    assert permissions["__embed__"] == [
        {"level": "CAN_RUN", "group_name": "data_analysts"},
        {"level": "CAN_MANAGE", "user_name": "user1@example.com"},
    ]
