import json
from pathlib import Path

import pytest

from dagshund import DagshundError, DiffState
from dagshund.markdown import (
    _render_drift_warnings,
    _render_field_change,
    _render_header,
    _render_resource,
    _render_resource_groups,
    _render_summary,
    _render_warnings,
    render_markdown,
)

# --- _render_field_change ---


def test_render_field_change_update_shows_transition() -> None:
    change = {"action": "update", "old": "a", "new": "b"}

    result = _render_field_change("field", change)

    assert result is not None
    assert "`~` `field`" in result
    assert '"a" -> "b"' in result


def test_render_field_change_unchanged_returns_none() -> None:
    change = {"action": "skip"}
    assert _render_field_change("field", change) is None


def test_render_field_change_noop_old_equals_new_suppressed() -> None:
    change = {"action": "update", "old": "same", "new": "same"}
    assert _render_field_change("field", change) is None


def test_render_field_change_drift_shows_remote_to_new() -> None:
    change = {"action": "update", "old": "UI_LOCKED", "new": "UI_LOCKED", "remote": "EDITABLE"}

    result = _render_field_change("edit_mode", change)

    assert result is not None
    assert '"EDITABLE" -> "UI_LOCKED"' in result
    assert "(drift)" in result


def test_render_field_change_remote_only_shows_remote_value() -> None:
    change = {"action": "update", "remote": {"no_alert": False}}

    result = _render_field_change("email_notifications", change)

    assert result is not None
    assert "{no_alert: false}" in result
    assert "(remote)" in result


def test_render_field_change_remote_only_shows_remote_symbol() -> None:
    """Field with action='update' but only 'remote' should show '=' not '~'."""
    change = {"action": "update", "remote": "PERFORMANCE_OPTIMIZED"}

    result = _render_field_change("performance_target", change)

    assert result is not None
    assert "`=`" in result
    assert "`~`" not in result


def test_render_field_change_create_shows_new_value() -> None:
    change = {"action": "create", "new": "value"}

    result = _render_field_change("field", change)

    assert result is not None
    assert "`+` `field`" in result
    assert '"value"' in result


def test_render_field_change_large_dict_shows_summary() -> None:
    large_dict = {
        "job_id": 0,
        "job_parameters": {
            "job_id": "{{job.parameters.job_id}}",
            "job_run_id": "{{job.parameters.job_run_id}}",
        },
    }
    change = {"action": "create", "new": large_dict}

    result = _render_field_change("run_job_task", change)

    assert result is not None
    assert "{2 fields}" in result
    assert "\n" not in result


def test_render_field_change_no_old_no_new_shows_field_only() -> None:
    change = {"action": "update"}

    result = _render_field_change("field", change)

    assert result is not None
    assert "`~` `field`" in result


def test_render_field_change_update_new_only_shows_create_symbol() -> None:
    """Field with action='update' but only 'new' should show '+' not '~'."""
    change = {"action": "update", "new": {"job_id": 0, "task_key": "my_task"}}

    result = _render_field_change("tasks[task_key='my_task']", change)

    assert result is not None
    assert "`+`" in result
    assert "`~`" not in result


def test_render_field_change_update_old_only_shows_delete_symbol() -> None:
    """Field with action='update' but only 'old' should show '-' not '~'."""
    change = {"action": "update", "old": "removed_value"}

    result = _render_field_change("deprecated_field", change)

    assert result is not None
    assert "`-`" in result
    assert "`~`" not in result


def test_render_field_change_long_strings_truncated() -> None:
    change = {"action": "update", "old": "a" * 50, "new": "b" * 50}

    result = _render_field_change("field", change)

    assert result is not None
    assert "... -> ..." in result


# --- _render_resource ---


def test_render_resource_create_action() -> None:
    lines = list(_render_resource("resources.jobs.etl", {"action": "create"}))

    assert len(lines) == 1
    assert "`+`" in lines[0]
    assert "`jobs/etl`" in lines[0]
    assert "create" in lines[0]


def test_render_resource_delete_action() -> None:
    lines = list(_render_resource("resources.jobs.old", {"action": "delete"}))

    assert "`-`" in lines[0]
    assert "delete" in lines[0]


def test_render_resource_update_shows_field_changes() -> None:
    entry = {
        "action": "update",
        "changes": {
            "max_concurrent_runs": {"action": "update", "old": 1, "new": 5},
            "skipped_field": {"action": "skip"},
        },
    }

    lines = list(_render_resource("resources.jobs.pipeline", entry))

    assert "`~`" in lines[0]
    assert "update" in lines[0]
    assert len(lines) == 2  # header + one field change
    assert "max_concurrent_runs" in lines[1]
    assert "1 -> 5" in lines[1]


def test_render_resource_skip_action_omits_label() -> None:
    lines = list(_render_resource("resources.jobs.stable", {"action": "skip"}))

    assert "jobs/stable" in lines[0]
    assert "\u2014" not in lines[0]  # em-dash label not present


def test_render_resource_drift_warning_shown_for_update() -> None:
    entry = {
        "action": "update",
        "changes": {
            "edit_mode": {"action": "update", "old": "UI_LOCKED", "new": "UI_LOCKED", "remote": "EDITABLE"},
        },
    }

    lines = list(_render_resource("resources.jobs.pipeline", entry))

    assert any(":warning:" in line for line in lines)


def test_render_resource_no_drift_warning_for_create() -> None:
    entry = {
        "action": "create",
        "changes": {
            "edit_mode": {"action": "update", "old": "UI_LOCKED", "new": "UI_LOCKED", "remote": "EDITABLE"},
        },
    }

    lines = list(_render_resource("resources.jobs.pipeline", entry))

    assert not any(":warning:" in line for line in lines)


# --- _render_header ---


def test_render_header_shows_version_info() -> None:
    lines = list(_render_header({"cli_version": "0.287.0", "plan_version": 2}))

    assert "### dagshund plan (v2, cli 0.287.0)" in lines[0]


def test_render_header_defaults_when_missing() -> None:
    lines = list(_render_header({}))

    assert "unknown" in lines[0]
    assert "?" in lines[0]


# --- _render_resource_groups ---


def test_render_resource_groups_produces_h4_headers() -> None:
    by_type = {"jobs": {"resources.jobs.etl": {"action": "create"}}}

    lines = list(_render_resource_groups(by_type))

    assert any(line.startswith("#### jobs") for line in lines)
    assert any("`jobs/etl`" in line for line in lines)


def test_render_resource_groups_respects_visible_states() -> None:
    by_type = {
        "jobs": {"resources.jobs.a": {"action": "skip"}, "resources.jobs.b": {"action": "create"}},
    }

    lines = list(_render_resource_groups(by_type, visible_states=frozenset({DiffState.ADDED})))

    text = "\n".join(lines)
    assert "jobs/b" in text
    assert "jobs/a" not in text
    assert "(1/2)" in text


# --- _render_summary ---


def test_render_summary_shows_bold_counts() -> None:
    resources = {"a": {"action": "create"}, "b": {"action": "delete"}}

    lines = list(_render_summary(resources))

    text = "\n".join(lines)
    assert "**+1** create" in text
    assert "**-1** delete" in text


def test_render_summary_empty_plan() -> None:
    assert list(_render_summary({})) == []


# --- _render_warnings ---


def test_render_warnings_uses_caution_block() -> None:
    warnings = ["volumes/data will be deleted \u2014 all files lost"]

    lines = list(_render_warnings(warnings))

    text = "\n".join(lines)
    assert "> [!CAUTION]" in text
    assert "**Dangerous Actions**" in text
    assert "volumes/data" in text


# --- _render_drift_warnings ---


def test_render_drift_warnings_uses_warning_block() -> None:
    warnings = ["jobs/pipeline was edited outside the bundle (1 field will be overwritten)"]

    lines = list(_render_drift_warnings(warnings))

    text = "\n".join(lines)
    assert "> [!WARNING]" in text
    assert "**Manual Edits Detected**" in text
    assert "jobs/pipeline" in text


# --- render_markdown (integration) ---


def test_render_markdown_non_dict_plan_raises_error() -> None:
    with pytest.raises(DagshundError, match="plan must be an object"):
        render_markdown({"plan": "not_a_dict"})


def test_render_markdown_empty_plan_raises_error() -> None:
    with pytest.raises(DagshundError, match="plan is empty"):
        render_markdown({"plan": {}})


def test_render_markdown_no_changes(fixtures_dir: Path) -> None:
    plan = json.loads((fixtures_dir / "no-changes" / "plan.json").read_text())

    result = render_markdown(plan)

    assert "No changes" in result
    assert "5 resources unchanged" in result
    assert "###" in result


def test_render_markdown_complex_plan(real_plan_json: str) -> None:
    result = render_markdown(json.loads(real_plan_json))

    assert "### dagshund plan" in result
    assert "#### jobs" in result
    assert "`jobs/etl_pipeline`" in result
    assert "**+2** create" in result
    assert "**-1** delete" in result
    assert "> [!CAUTION]" in result
    assert "volumes/old_exports" in result


def test_render_markdown_drift_plan(fixtures_dir: Path) -> None:
    plan = json.loads((fixtures_dir / "manual-drift" / "plan.json").read_text())

    result = render_markdown(plan)

    assert ":warning:" in result
    assert "(drift)" in result
    assert "> [!WARNING]" in result
    assert "Manual Edits Detected" in result


def test_render_markdown_with_visible_states(fixtures_dir: Path) -> None:
    plan = json.loads((fixtures_dir / "mixed-changes" / "plan.json").read_text())

    result = render_markdown(plan, visible_states=frozenset({DiffState.ADDED}))

    assert "create" in result
    assert "delete" not in result.split("create")[0]  # no deletes before create section


def test_render_markdown_with_filter_query(fixtures_dir: Path) -> None:
    plan = json.loads((fixtures_dir / "mixed-changes" / "plan.json").read_text())

    result = render_markdown(plan, filter_query="type:alerts")

    assert "#### alerts" in result
    assert "#### jobs" not in result


def test_render_markdown_returns_string_not_none(real_plan_json: str) -> None:
    result = render_markdown(json.loads(real_plan_json))
    assert isinstance(result, str)
    assert len(result) > 0


def test_render_markdown_mixed_plan(fixtures_dir: Path) -> None:
    plan = json.loads((fixtures_dir / "mixed-changes" / "plan.json").read_text())

    result = render_markdown(plan)

    assert "create" in result
    assert "delete" in result
    assert "update" in result
