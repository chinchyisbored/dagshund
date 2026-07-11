import json
import os
import sys
from pathlib import Path

import pytest
from factories import (
    make_change,
    make_plan,
    make_resource,
    plan_from_dict,
    resources_from_dict,
)

from dagshund.merge import merge_sub_resources, normalize_plan
from dagshund.model import FieldChange
from dagshund.plan import detect_changes
from dagshund.terminal import (
    GREEN,
    RED,
    RESET,
    _colorize,
    _detect_terminal_width,
    _print_header,
    _print_resource_groups,
    _print_summary,
    _print_warnings,
    _render_field_change,
    _render_resource,
    _supports_color,
    _wrap_transition,
    _wrap_warning_line,
    render_text,
)
from dagshund.types import DagshundError, DiffState

# --- render_text merges sub-resources (integration) ---


def test_render_text_merges_sub_resources(capsys: pytest.CaptureFixture[str]) -> None:
    plan = plan_from_dict(
        {
            "plan_version": 2,
            "cli_version": "0.292.0",
            "plan": {
                "resources.jobs.test_job": {"action": "skip"},
                "resources.jobs.test_job.permissions": {
                    "action": "update",
                    "changes": {
                        "permissions[group_name='users'].permission_level": {
                            "action": "update",
                            "old": "CAN_VIEW",
                            "new": "CAN_MANAGE",
                        },
                    },
                },
            },
        }
    )

    render_text(plan)

    out = capsys.readouterr().out
    assert "test_job" in out
    # Parent promoted to update, so prefixed changes from permissions are visible
    assert "permissions.permissions[group_name='users'].permission_level" in out
    # Sub-resource keys don't appear as separate entries
    assert "permissions/" not in out


def test_detect_changes_true_after_merge_promotes_parent() -> None:
    resources = resources_from_dict(
        {
            "resources.jobs.my_job": {"action": "skip"},
            "resources.jobs.my_job.permissions": {
                "action": "update",
                "changes": {
                    "permissions[group_name='users'].permission_level": {
                        "action": "update",
                        "old": "CAN_VIEW",
                        "new": "CAN_MANAGE",
                    },
                },
            },
        }
    )

    # Before merge: parent is skip, no changes detected
    assert detect_changes({"resources.jobs.my_job": resources["resources.jobs.my_job"]}) is False

    # After merge: parent promoted to update
    merged = merge_sub_resources(resources)
    assert detect_changes(merged) is True


# --- _supports_color ---


def test_supports_color_no_color_empty_disables(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("NO_COLOR", "")
    assert _supports_color() is False


def test_supports_color_no_color_with_value_disables(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("NO_COLOR", "1")
    assert _supports_color() is False


def test_supports_color_force_color_enables(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("NO_COLOR", raising=False)
    monkeypatch.setenv("FORCE_COLOR", "1")
    assert _supports_color() is True


def test_supports_color_force_color_zero_falls_through(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("NO_COLOR", raising=False)
    monkeypatch.setenv("FORCE_COLOR", "0")
    # "0" is treated as unset, falls through to isatty (not a tty in tests)
    assert _supports_color() is False


def test_supports_color_isatty_true(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("NO_COLOR", raising=False)
    monkeypatch.delenv("FORCE_COLOR", raising=False)
    monkeypatch.setattr(sys.stdout, "isatty", lambda: True)
    assert _supports_color() is True


def test_supports_color_isatty_false(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("NO_COLOR", raising=False)
    monkeypatch.delenv("FORCE_COLOR", raising=False)
    monkeypatch.setattr(sys.stdout, "isatty", lambda: False)
    assert _supports_color() is False


# --- _colorize ---


def test_colorize_applies_ansi_when_enabled() -> None:
    assert _colorize("hello", GREEN, use_color=True) == f"{GREEN}hello{RESET}"


def test_colorize_returns_plain_when_disabled() -> None:
    assert _colorize("hello", GREEN, use_color=False) == "hello"


# --- _render_field_change ---


def test_render_field_change_large_dict_shows_summary() -> None:
    """Large dict in a field add shows a summary instead of full content."""
    large_dict = {
        "job_id": 0,
        "job_parameters": {
            "job_id": "{{job.parameters.job_id}}",
            "job_run_id": "{{job.parameters.job_run_id}}",
        },
    }
    change = make_change(action="create", new=large_dict)

    result = _render_field_change("run_job_task", change, use_color=False)

    assert result is not None
    assert "{2 fields}" in result
    assert "\n" not in result


def test_render_field_change_long_old_and_new_shows_ellipsis() -> None:
    change = make_change(action="update", old="a" * 50, new="b" * 50)

    result = _render_field_change("field", change, use_color=False)

    assert result is not None
    assert "... -> ..." in result


def test_render_field_change_long_new_short_old_preserves_short() -> None:
    change = make_change(action="update", old=None, new="a" * 50)

    result = _render_field_change("field", change, use_color=False)

    assert result is not None
    assert "null -> ..." in result


def test_render_field_change_long_old_short_new_preserves_short() -> None:
    change = make_change(action="update", old="a" * 50, new=42)

    result = _render_field_change("field", change, use_color=False)

    assert result is not None
    assert "... -> 42" in result


def test_render_field_change_short_string_old_long_new_preserves_short() -> None:
    change = make_change(action="update", old="short text", new="a" * 50)

    result = _render_field_change("field", change, use_color=False)

    assert result is not None
    assert '"short text" -> ...' in result


def test_render_field_change_long_old_null_new_preserves_null() -> None:
    change = make_change(action="update", old="a" * 50, new=None)

    result = _render_field_change("field", change, use_color=False)

    assert result is not None
    assert "... -> null" in result


def test_render_field_change_long_new_only_shows_ellipsis() -> None:
    change = make_change(action="create", new="a" * 50)

    result = _render_field_change("field", change, use_color=False)

    assert result is not None
    assert ": ..." in result


def test_render_field_change_short_values_show_inline() -> None:
    change = make_change(action="update", old="short", new="also short")

    result = _render_field_change("field", change, use_color=False)

    assert result is not None
    assert '"short" -> "also short"' in result


def test_render_field_change_long_old_missing_new_shows_ellipsis() -> None:
    change = make_change(action="delete", old="a" * 50)

    result = _render_field_change("field", change, use_color=False)

    assert result is not None
    assert ": ..." in result
    assert "->" not in result


def test_render_field_change_dict_old_long_new_preserves_dict() -> None:
    change = make_change(action="update", old={"a": 1}, new="b" * 50)

    result = _render_field_change("field", change, use_color=False)

    assert result is not None
    assert "{a: 1} -> ..." in result


def test_render_field_change_no_old_no_new_shows_field_only() -> None:
    change = make_change(action="update")

    result = _render_field_change("field", change, use_color=False)

    assert result is not None
    assert result.strip() == "~ field"


def test_render_field_change_unchanged_returns_none() -> None:
    change = make_change(action="skip")

    result = _render_field_change("field", change, use_color=False)

    assert result is None


def test_render_field_change_drift_shows_remote_to_new() -> None:
    change = make_change(action="update", old="UI_LOCKED", new="UI_LOCKED", remote="EDITABLE")

    result = _render_field_change("edit_mode", change, use_color=False)

    assert result is not None
    assert '"EDITABLE" -> "UI_LOCKED"' in result
    assert "(drift)" in result


def test_render_field_change_noop_old_equals_new_no_remote_suppressed() -> None:
    change = make_change(action="update", old={"key": "val"}, new={"key": "val"})

    result = _render_field_change("task", change, use_color=False)

    assert result is None


def test_render_field_change_noop_old_equals_new_equals_remote_suppressed() -> None:
    change = make_change(action="update", old="A", new="A", remote="A")

    result = _render_field_change("field", change, use_color=False)

    assert result is None


def test_render_field_change_remote_only_shows_remote_value() -> None:
    change = make_change(action="update", remote={"no_alert": False})

    result = _render_field_change("email_notifications", change, use_color=False)

    assert result is not None
    assert "{no_alert: false}" in result
    assert "(remote)" in result


def test_render_field_change_remote_only_scalar_shows_value() -> None:
    change = make_change(action="update", remote="PERFORMANCE_OPTIMIZED")

    result = _render_field_change("performance_target", change, use_color=False)

    assert result is not None
    assert '"PERFORMANCE_OPTIMIZED"' in result
    assert "(remote)" in result


def test_render_field_change_remote_only_shows_remote_symbol() -> None:
    """Field with action='update' but only 'remote' should show '=' not '~'."""
    change = make_change(action="update", remote="PERFORMANCE_OPTIMIZED")

    result = _render_field_change("performance_target", change, use_color=False)

    assert result is not None
    assert result.strip().startswith("=")


def test_render_field_change_update_new_only_shows_create_symbol() -> None:
    """Field with action='update' but only 'new' should show '+' not '~'."""
    change = make_change(action="update", new={"job_id": 0, "task_key": "my_task"})

    result = _render_field_change("tasks[task_key='my_task']", change, use_color=False)

    assert result is not None
    assert result.strip().startswith("+")


def test_render_field_change_update_old_only_shows_delete_symbol() -> None:
    """Field with action='update' but only 'old' should show '-' not '~'."""
    change = make_change(action="update", old="removed_value")

    result = _render_field_change("deprecated_field", change, use_color=False)

    assert result is not None
    assert result.strip().startswith("-")


def test_render_field_change_update_both_old_and_new_shows_update_symbol() -> None:
    """Field with action='update' and both 'old' and 'new' keeps '~'."""
    change = make_change(action="update", old="before", new="after")

    result = _render_field_change("field", change, use_color=False)

    assert result is not None
    assert result.strip().startswith("~")


# --- _render_resource ---


def test_render_resource_create_action() -> None:
    lines = list(_render_resource("resources.jobs.etl", make_resource(action="create"), use_color=False))

    assert len(lines) == 1
    assert "+ jobs/etl" in lines[0]
    assert "(create)" in lines[0]


def test_render_resource_delete_action() -> None:
    lines = list(_render_resource("resources.jobs.old", make_resource(action="delete"), use_color=False))

    assert "- jobs/old" in lines[0]
    assert "(delete)" in lines[0]


def test_render_resource_update_shows_field_changes() -> None:
    entry = make_resource(
        action="update",
        changes={
            "max_concurrent_runs": make_change(action="update", old=1, new=5),
            "skipped_field": make_change(action="skip"),
        },
    )

    lines = list(_render_resource("resources.jobs.pipeline", entry, use_color=False))

    assert "~ jobs/pipeline" in lines[0]
    assert "(update)" in lines[0]
    assert len(lines) == 2  # header + one field change (skip excluded)
    assert "max_concurrent_runs" in lines[1]
    assert "1 -> 5" in lines[1]


def test_render_resource_field_change_new_only() -> None:
    entry = make_resource(
        action="update",
        changes={"new_field": make_change(action="create", new="value")},
    )

    lines = list(_render_resource("resources.jobs.pipeline", entry, use_color=False))

    assert len(lines) == 2
    assert '"value"' in lines[1]


def test_render_resource_field_change_old_only() -> None:
    entry = make_resource(
        action="update",
        changes={"removed_field": make_change(action="delete", old="gone")},
    )

    lines = list(_render_resource("resources.jobs.pipeline", entry, use_color=False))

    assert len(lines) == 2
    assert '"gone"' in lines[1]


def test_render_resource_skip_action_omits_label() -> None:
    lines = list(_render_resource("resources.jobs.stable", make_resource(action="skip"), use_color=False))

    assert "= jobs/stable" in lines[0]
    assert "(skip)" not in lines[0]
    assert "(unchanged)" not in lines[0]


def test_render_resource_empty_action_shows_unchanged() -> None:
    lines = list(_render_resource("resources.jobs.stable", make_resource(action=""), use_color=False))

    assert "= jobs/stable" in lines[0]
    assert "(unchanged)" not in lines[0]


def test_render_resource_field_change_null_old_shows_transition() -> None:
    entry = make_resource(
        action="update",
        changes={"field": make_change(action="update", old=None, new="value")},
    )

    lines = list(_render_resource("resources.jobs.pipeline", entry, use_color=False))

    assert len(lines) == 2
    assert "null" in lines[1]
    assert "->" in lines[1]
    assert '"value"' in lines[1]


def test_render_resource_field_change_null_new_shows_transition() -> None:
    entry = make_resource(
        action="update",
        changes={"field": make_change(action="update", old="value", new=None)},
    )

    lines = list(_render_resource("resources.jobs.pipeline", entry, use_color=False))

    assert len(lines) == 2
    assert '"value"' in lines[1]
    assert "->" in lines[1]
    assert "null" in lines[1]


def test_render_resource_field_change_both_null_surfaces_as_topology_drift() -> None:
    """Shape-level predicate: {old: None, new: None, no remote} is topology drift.

    Real plan.json never emits this for scalar fields — Databricks simply omits
    unchanged fields from `changes`. If it does appear, the new contract is that
    is_topology_drift_change catches it and the renderer surfaces it as a re-add,
    which matches the JS port (structural-diff.ts:35).
    """
    entry = make_resource(
        action="update",
        changes={"field": make_change(action="update", old=None, new=None)},
    )

    lines = list(_render_resource("resources.jobs.pipeline", entry, use_color=False))

    assert any("manually edited outside bundle" in line for line in lines)
    assert any("field" in line and "(re-added)" in line for line in lines)


def test_render_resource_with_color_includes_ansi() -> None:
    lines = list(_render_resource("resources.jobs.etl", make_resource(action="create"), use_color=True))

    assert GREEN in lines[0]
    assert RESET in lines[0]


@pytest.mark.parametrize(
    "action",
    ["recreate", "resize", "update_id"],
    ids=["recreate", "resize", "update_id"],
)
def test_render_resource_update_action_shows_field_changes(action: str) -> None:
    entry = make_resource(
        action=action,
        changes={"threshold": make_change(action="update", old=10, new=20)},
    )

    lines = list(_render_resource("resources.jobs.pipeline", entry, use_color=False))

    assert f"({action})" in lines[0]
    assert "~ jobs/pipeline" in lines[0]
    assert len(lines) == 2
    assert "threshold" in lines[1]
    assert "10 -> 20" in lines[1]


def test_render_resource_field_change_no_old_no_new() -> None:
    entry = make_resource(
        action="update",
        changes={"mystery_field": make_change(action="update")},
    )

    lines = list(_render_resource("resources.jobs.pipeline", entry, use_color=False))

    assert len(lines) == 2
    assert "mystery_field" in lines[1]
    assert "->" not in lines[1]


def test_render_resource_field_change_missing_action_key() -> None:
    """Field change dict without an action key falls back to default (unchanged)."""
    entry = make_resource(
        action="update",
        changes={"orphan_field": make_change(old=1, new=2)},
    )

    lines = list(_render_resource("resources.jobs.pipeline", entry, use_color=False))

    # Default action maps to DiffState.UNCHANGED, so field is filtered out
    assert len(lines) == 1


def test_render_resource_non_dict_changes_skips_field_details() -> None:
    entry = make_resource(action="update")

    lines = list(_render_resource("resources.jobs.etl", entry, use_color=False))

    assert len(lines) == 1
    assert "(update)" in lines[0]


def test_render_resource_non_dict_change_entry_skips_that_field() -> None:
    entry = make_resource(
        action="update",
        changes={
            "good_field": make_change(action="update", old=1, new=2),
        },
    )

    lines = list(_render_resource("resources.jobs.etl", entry, use_color=False))

    assert len(lines) == 2
    assert "good_field" in lines[1]
    assert "bad_field" not in lines[1]


# --- _print_header ---


def test_print_header_shows_version_info(capsys: pytest.CaptureFixture[str]) -> None:
    _print_header(make_plan(cli_version="0.287.0", plan_version=2), use_color=False)

    out = capsys.readouterr().out
    assert "v2" in out
    assert "0.287.0" in out


def test_print_header_defaults_when_missing(capsys: pytest.CaptureFixture[str]) -> None:
    _print_header(make_plan(), use_color=False)

    out = capsys.readouterr().out
    assert "unknown" in out
    assert "?" in out


# --- _print_resource_groups ---


def test_print_resource_groups_renders_type_header_and_entries(capsys: pytest.CaptureFixture[str]) -> None:
    by_type = {"jobs": resources_from_dict({"resources.jobs.etl": {"action": "create"}})}

    _print_resource_groups(by_type, use_color=False)

    out = capsys.readouterr().out
    assert "jobs (1)" in out
    assert "+ jobs/etl" in out


def test_print_resource_groups_multiple_types(capsys: pytest.CaptureFixture[str]) -> None:
    by_type = {
        "alerts": resources_from_dict({"resources.alerts.a": {"action": "delete"}}),
        "jobs": resources_from_dict({"resources.jobs.etl": {"action": "create"}}),
    }

    _print_resource_groups(by_type, use_color=False)

    out = capsys.readouterr().out
    assert "alerts (1)" in out
    assert "jobs (1)" in out
    assert "- alerts/a" in out
    assert "+ jobs/etl" in out


def test_print_resource_groups_empty_dict(capsys: pytest.CaptureFixture[str]) -> None:
    _print_resource_groups({}, use_color=False)

    assert capsys.readouterr().out == ""


# --- _print_summary ---


def test_print_summary_shows_action_counts(capsys: pytest.CaptureFixture[str]) -> None:
    plan = resources_from_dict({"a": {"action": "create"}, "b": {"action": "delete"}})

    _print_summary(plan, use_color=False)

    out = capsys.readouterr().out
    assert "+1 create" in out
    assert "-1 delete" in out


def test_print_summary_unchanged_uses_dim_style(capsys: pytest.CaptureFixture[str]) -> None:
    plan = resources_from_dict({"a": {"action": "create"}, "b": {"action": "skip"}})

    _print_summary(plan, use_color=False)

    out = capsys.readouterr().out
    assert "=1 unchanged" in out
    assert "?" not in out


def test_print_summary_empty_plan(capsys: pytest.CaptureFixture[str]) -> None:
    _print_summary({}, use_color=False)

    out = capsys.readouterr().out
    assert out.strip() == ""


def test_print_summary_all_same_action(capsys: pytest.CaptureFixture[str]) -> None:
    plan = resources_from_dict({"a": {"action": "create"}, "b": {"action": "create"}})

    _print_summary(plan, use_color=False)

    out = capsys.readouterr().out
    assert "+2 create" in out
    assert "," not in out  # only one action type, no comma separator


# --- render_text (integration) ---


def test_render_text_empty_plan_raises_error() -> None:
    with pytest.raises(DagshundError, match="plan is empty"):
        render_text(plan_from_dict({"plan": {}}))


def test_render_text_missing_plan_key_raises_error() -> None:
    with pytest.raises(DagshundError, match="plan is empty"):
        render_text(plan_from_dict({"cli_version": "1.0"}))


def test_render_text_all_unchanged_shows_no_changes(fixtures_dir: Path, capsys: pytest.CaptureFixture[str]) -> None:
    plan = plan_from_dict(json.loads((fixtures_dir / "no-changes" / "plan.json").read_text()))

    render_text(plan)

    out = capsys.readouterr().out
    assert "No changes" in out
    assert "5 resources unchanged" in out
    # Should NOT list individual resources
    assert "alerts" not in out
    assert "(skip)" not in out
    assert "(unchanged)" not in out


def test_render_text_invalid_plan_does_not_raise(fixtures_dir: Path, capsys: pytest.CaptureFixture[str]) -> None:
    """A malformed plan (bad action, non-dict changes, wrong-typed version) must render without raising."""
    plan = plan_from_dict(json.loads((fixtures_dir / "invalid-plan.json").read_text()))

    render_text(plan)

    out = capsys.readouterr().out
    assert "some_resource" in out


def test_render_text_force_color_includes_ansi(
    monkeypatch: pytest.MonkeyPatch, real_plan_json: str, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.delenv("NO_COLOR", raising=False)
    monkeypatch.setenv("FORCE_COLOR", "1")

    render_text(plan_from_dict(json.loads(real_plan_json)))

    out = capsys.readouterr().out
    assert RESET in out


def test_render_text_no_color_excludes_ansi(
    monkeypatch: pytest.MonkeyPatch, real_plan_json: str, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setenv("NO_COLOR", "")

    render_text(plan_from_dict(json.loads(real_plan_json)))

    out = capsys.readouterr().out
    assert RESET not in out


# --- _print_resource_groups with visible_states ---


def test_print_resource_groups_visible_states_hides_unchanged_groups(
    capsys: pytest.CaptureFixture[str],
) -> None:
    by_type = {
        "jobs": resources_from_dict({"resources.jobs.a": {"action": "skip"}, "resources.jobs.b": {"action": "skip"}}),
        "alerts": resources_from_dict({"resources.alerts.a": {"action": "create"}}),
    }

    _print_resource_groups(by_type, use_color=False, visible_states=frozenset({DiffState.ADDED}))

    out = capsys.readouterr().out
    assert "alerts" in out
    assert "jobs" not in out


def test_print_resource_groups_visible_states_shows_partial_count(
    capsys: pytest.CaptureFixture[str],
) -> None:
    by_type = {
        "experiments": resources_from_dict(
            {
                "resources.experiments.a": {"action": "skip"},
                "resources.experiments.b": {"action": "create"},
            }
        ),
    }

    _print_resource_groups(by_type, use_color=False, visible_states=frozenset({DiffState.ADDED}))

    out = capsys.readouterr().out
    assert "experiments (1/2)" in out
    assert "experiments/b" in out
    assert "experiments/a" not in out


def test_print_resource_groups_no_visible_states_shows_all(
    capsys: pytest.CaptureFixture[str],
) -> None:
    by_type = {
        "jobs": resources_from_dict({"resources.jobs.a": {"action": "skip"}, "resources.jobs.b": {"action": "create"}}),
    }

    _print_resource_groups(by_type, use_color=False)

    out = capsys.readouterr().out
    assert "jobs (2)" in out
    assert "jobs/a" in out
    assert "jobs/b" in out


# --- render_text with visible_states (integration) ---


def test_render_text_changes_only_hides_unchanged(fixtures_dir: Path, capsys: pytest.CaptureFixture[str]) -> None:
    plan = plan_from_dict(json.loads((fixtures_dir / "mixed-changes" / "plan.json").read_text()))
    all_changes = frozenset({DiffState.ADDED, DiffState.MODIFIED, DiffState.REMOVED})

    render_text(plan, visible_states=all_changes)

    out = capsys.readouterr().out
    # Changed resources visible
    assert "alerts/stale_pipeline_alert" in out
    assert "experiments/audit_analysis_final" in out
    assert "volumes/old_exports" in out
    # Individual unchanged resources hidden
    assert "volumes/raw_data" not in out
    # Summary excludes unchanged when filtering
    assert "unchanged" not in out


def test_render_text_added_only_shows_creates(fixtures_dir: Path, capsys: pytest.CaptureFixture[str]) -> None:
    plan = plan_from_dict(json.loads((fixtures_dir / "mixed-changes" / "plan.json").read_text()))

    render_text(plan, visible_states=frozenset({DiffState.ADDED}))

    out = capsys.readouterr().out
    assert "experiments/audit_analysis_final" in out
    assert "(create)" in out
    # No modified or deleted
    assert "alerts/stale_pipeline_alert" not in out
    assert "volumes/old_exports" not in out


def test_render_text_removed_only_shows_deletes(fixtures_dir: Path, capsys: pytest.CaptureFixture[str]) -> None:
    plan = plan_from_dict(json.loads((fixtures_dir / "mixed-changes" / "plan.json").read_text()))

    render_text(plan, visible_states=frozenset({DiffState.REMOVED}))

    out = capsys.readouterr().out
    assert "volumes/old_exports" in out
    assert "(delete)" in out
    assert "experiments" not in out


def test_render_text_no_visible_states_shows_everything(fixtures_dir: Path, capsys: pytest.CaptureFixture[str]) -> None:
    plan = plan_from_dict(json.loads((fixtures_dir / "mixed-changes" / "plan.json").read_text()))

    render_text(plan)

    out = capsys.readouterr().out
    assert "jobs" in out
    assert "schemas" in out
    assert "alerts" in out


# --- _print_warnings ---


def test_print_warnings_outputs_header_and_warning_symbol(capsys: pytest.CaptureFixture[str]) -> None:
    _print_warnings(["volumes/data will be deleted — all files in this volume will be lost"], use_color=False)

    out = capsys.readouterr().out
    assert "Dangerous Actions:" in out
    assert "\u26a0" in out
    assert "volumes/data" in out


def test_print_warnings_uses_color_when_enabled(capsys: pytest.CaptureFixture[str]) -> None:
    _print_warnings(["test warning"], use_color=True)

    out = capsys.readouterr().out
    assert RED in out
    assert RESET in out


def test_print_warnings_no_color_when_disabled(capsys: pytest.CaptureFixture[str]) -> None:
    _print_warnings(["test warning"], use_color=False)

    out = capsys.readouterr().out
    assert RED not in out


# --- render_text warnings (integration) ---


def test_render_text_shows_warning_for_volume_delete(fixtures_dir: Path, capsys: pytest.CaptureFixture[str]) -> None:
    plan = plan_from_dict(json.loads((fixtures_dir / "mixed-changes" / "plan.json").read_text()))

    render_text(plan)

    out = capsys.readouterr().out
    assert "\u26a0" in out
    assert "volumes/old_exports" in out
    assert "deleted" in out


def test_render_text_warning_appears_after_summary(fixtures_dir: Path, capsys: pytest.CaptureFixture[str]) -> None:
    plan = plan_from_dict(json.loads((fixtures_dir / "mixed-changes" / "plan.json").read_text()))

    render_text(plan)

    out = capsys.readouterr().out
    summary_pos = out.index("create,")
    warning_pos = out.index("\u26a0")
    assert warning_pos > summary_pos


def test_render_text_no_warnings_for_safe_plan(capsys: pytest.CaptureFixture[str]) -> None:
    plan = plan_from_dict(
        {
            "plan_version": 2,
            "cli_version": "0.288.0",
            "plan": {
                "resources.jobs.etl": {"action": "delete"},
                "resources.alerts.old": {"action": "delete"},
            },
        }
    )

    render_text(plan)

    out = capsys.readouterr().out
    assert "\u26a0" not in out


def test_render_text_warning_hidden_when_filtered_out(fixtures_dir: Path, capsys: pytest.CaptureFixture[str]) -> None:
    plan = plan_from_dict(json.loads((fixtures_dir / "mixed-changes" / "plan.json").read_text()))

    render_text(plan, visible_states=frozenset({DiffState.ADDED}))

    out = capsys.readouterr().out
    assert "\u26a0" not in out


def test_render_text_schema_recreate_warns(capsys: pytest.CaptureFixture[str]) -> None:
    plan = plan_from_dict(
        {
            "plan_version": 2,
            "cli_version": "0.288.0",
            "plan": {
                "resources.schemas.analytics": {"action": "recreate"},
            },
        }
    )

    render_text(plan)

    out = capsys.readouterr().out
    assert "\u26a0" in out
    assert "schemas/analytics" in out
    assert "recreated" in out


# --- _render_resource with drift ---


def test_render_resource_shows_drift_warning_when_drift_detected() -> None:
    entry = make_resource(
        action="update",
        changes={
            "edit_mode": make_change(action="update", old="UI_LOCKED", new="UI_LOCKED", remote="EDITABLE"),
        },
    )
    lines = list(_render_resource("resources.jobs.pipeline", entry, use_color=False))
    assert any("manually edited outside bundle" in line for line in lines)


def test_render_resource_no_drift_warning_for_create_action() -> None:
    entry = make_resource(
        action="create",
        changes={
            "edit_mode": make_change(action="update", old="UI_LOCKED", new="UI_LOCKED", remote="EDITABLE"),
        },
    )
    lines = list(_render_resource("resources.jobs.pipeline", entry, use_color=False))
    assert not any("manually edited" in line for line in lines)


def test_render_resource_no_drift_warning_for_delete_action() -> None:
    entry = make_resource(
        action="delete",
        changes={
            "edit_mode": make_change(action="update", old="UI_LOCKED", new="UI_LOCKED", remote="EDITABLE"),
        },
    )
    lines = list(_render_resource("resources.jobs.pipeline", entry, use_color=False))
    assert not any("manually edited" in line for line in lines)


def test_render_resource_no_drift_warning_when_no_drift() -> None:
    entry = make_resource(
        action="update",
        changes={
            "max_concurrent_runs": make_change(action="update", old=1, new=5),
        },
    )
    lines = list(_render_resource("resources.jobs.pipeline", entry, use_color=False))
    assert not any("manually edited" in line for line in lines)


# --- _render_resource topology drift ---


@pytest.mark.parametrize(
    ("change_key", "expected_token"),
    [
        ("tasks[task_key='transform']", "tasks[task_key='transform']"),
        ("grants.[principal='data_engineers']", "grants.[principal='data_engineers']"),
    ],
)
def test_render_resource_topology_drift_emits_single_reentry_line(change_key: str, expected_token: str) -> None:
    entry = make_resource(
        action="update",
        changes={
            change_key: make_change(action="update", old={"x": 1}, new={"x": 1}),
        },
    )
    lines = list(_render_resource("resources.jobs.pipeline", entry, use_color=False))
    matching = [line for line in lines if expected_token in line]
    assert len(matching) == 1
    assert matching[0].endswith("(drift) (re-added)")
    assert "+" in matching[0]
    assert any("manually edited outside bundle" in line for line in lines)


def test_render_resource_mixed_field_and_topology_drift() -> None:
    entry = make_resource(
        action="update",
        changes={
            "edit_mode": make_change(action="update", old="UI", new="UI", remote="EDITABLE"),
            "tasks[task_key='transform']": make_change(action="update", old={"x": 1}, new={"x": 1}),
        },
    )
    lines = list(_render_resource("resources.jobs.pipeline", entry, use_color=False))
    assert any("manually edited outside bundle" in line for line in lines)
    assert any("edit_mode" in line and "(drift)" in line for line in lines)
    assert any("tasks[task_key='transform']" in line and "(re-added)" in line for line in lines)


def test_render_resource_topology_drift_not_emitted_under_create_action() -> None:
    entry = make_resource(
        action="create",
        changes={
            "tasks[task_key='transform']": make_change(action="update", old={"x": 1}, new={"x": 1}),
        },
    )
    lines = list(_render_resource("resources.jobs.pipeline", entry, use_color=False))
    assert not any("(re-added)" in line for line in lines)


def test_render_resource_topology_drift_not_emitted_under_recreate_action() -> None:
    """A change with action=recreate (not update) must NOT render as re-added.

    is_topology_drift_change gates on action==update on the *change*, not the
    parent resource. This test locks the narrow inner gate: even though the
    parent is recreate (a show_field_changes action) and the change has the
    old==new/no-remote shape, action=recreate on the change itself blocks the
    re-add path.
    """
    entry = make_resource(
        action="recreate",
        changes={
            "tasks[task_key='transform']": make_change(action="recreate", old={"x": 1}, new={"x": 1}),
        },
    )
    lines = list(_render_resource("resources.jobs.pipeline", entry, use_color=False))
    assert not any("(re-added)" in line for line in lines)


# --- render_text drift integration ---


def test_render_text_shows_drift_section(capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("dagshund.terminal._supports_color", lambda: False)
    plan = plan_from_dict(
        {
            "plan": {
                "resources.jobs.drift_pipeline": {
                    "action": "update",
                    "changes": {
                        "edit_mode": {"action": "update", "old": "UI_LOCKED", "new": "UI_LOCKED", "remote": "EDITABLE"},
                        "owner": {"action": "update", "old": "x", "new": "x", "remote": "y"},
                        "tasks[task_key='transform']": {
                            "action": "update",
                            "old": {"task_key": "transform"},
                            "new": {"task_key": "transform"},
                        },
                    },
                },
            },
        }
    )

    render_text(plan)

    out = capsys.readouterr().out
    assert "Manual Edits Detected:" in out
    assert "jobs/drift_pipeline" in out
    assert "edited outside the bundle" in out
    assert "manually edited outside bundle" in out
    assert "2 fields will be overwritten" in out
    assert "1 task will be re-added (transform)" in out
    # Old flat parenthetical format must not leak back in
    assert "(2 fields will be overwritten)" not in out
    assert "(1 field will be overwritten)" not in out


def test_render_text_shows_drift_section_multiple_reentries_same_noun(
    capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    """Two topology-drift tasks on one resource → '2 tasks will be re-added (alpha, beta)'."""
    monkeypatch.setattr("dagshund.terminal._supports_color", lambda: False)
    plan = plan_from_dict(
        {
            "plan": {
                "resources.jobs.drift_pipeline": {
                    "action": "update",
                    "changes": {
                        "tasks[task_key='alpha']": {
                            "action": "update",
                            "old": {"task_key": "alpha"},
                            "new": {"task_key": "alpha"},
                        },
                        "tasks[task_key='beta']": {
                            "action": "update",
                            "old": {"task_key": "beta"},
                            "new": {"task_key": "beta"},
                        },
                    },
                },
            },
        }
    )

    render_text(plan)

    out = capsys.readouterr().out
    assert "2 tasks will be re-added (alpha, beta)" in out


# --- _detect_terminal_width ---


def test_detect_terminal_width_returns_columns(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(os, "get_terminal_size", lambda *_: os.terminal_size((100, 24)))

    assert _detect_terminal_width() == 100


def test_detect_terminal_width_fallback_80_on_oserror(monkeypatch: pytest.MonkeyPatch) -> None:
    def raise_oserror(*_: object) -> os.terminal_size:
        raise OSError("not a terminal")

    monkeypatch.setattr(os, "get_terminal_size", raise_oserror)

    assert _detect_terminal_width() == 80


def test_detect_terminal_width_fallback_80_on_value_error(monkeypatch: pytest.MonkeyPatch) -> None:
    def raise_value_error(*_: object) -> os.terminal_size:
        raise ValueError("bad fd")

    monkeypatch.setattr(os, "get_terminal_size", raise_value_error)

    assert _detect_terminal_width() == 80


# --- _wrap_transition ---


def test_wrap_transition_normal_splits_at_arrow() -> None:
    prefix = "      ~ config"
    change = make_change(action="update", old={"a": 1, "b": 2}, new={"a": 1, "b": 3})

    result = _wrap_transition(prefix, change)

    assert result is not None
    lines = result.split("\n")
    assert len(lines) == 2
    assert lines[0] == "      ~ config: {a: 1, b: 2}"
    assert lines[1] == "          -> {a: 1, b: 3}"


def test_wrap_transition_drift_includes_annotation() -> None:
    prefix = "      ~ edit_mode"
    change = make_change(action="update", old="UI_LOCKED", new="UI_LOCKED", remote="EDITABLE")

    result = _wrap_transition(prefix, change)

    assert result is not None
    lines = result.split("\n")
    assert len(lines) == 2
    assert '"EDITABLE"' in lines[0]
    assert '-> "UI_LOCKED" (drift)' in lines[1]


def test_wrap_transition_returns_none_for_single_value() -> None:
    prefix = "      + field"
    change = make_change(action="create", new="value")

    assert _wrap_transition(prefix, change) is None


def test_wrap_transition_returns_none_for_noop() -> None:
    prefix = "      ~ field"
    change = make_change(action="update", old="same", new="same")

    assert _wrap_transition(prefix, change) is None


def test_wrap_transition_truncates_long_strings() -> None:
    prefix = "      ~ field"
    change = make_change(action="update", old="a" * 50, new="b" * 50)

    result = _wrap_transition(prefix, change)

    assert result is not None
    lines = result.split("\n")
    assert lines[0] == "      ~ field: ..."
    assert lines[1] == "          -> ..."


# --- _wrap_warning_line ---


def test_wrap_warning_line_short_unchanged() -> None:
    line = "  \u26a0 short warning"

    assert _wrap_warning_line(line, 80) == line


def test_wrap_warning_line_long_wraps_at_word_boundary() -> None:
    line = (
        "  \u26a0 schemas/production will be deleted \u2014 all tables, views, and volumes in this schema will be lost"
    )

    result = _wrap_warning_line(line, 60)

    assert "\n" in result
    for output_line in result.split("\n"):
        assert len(output_line) <= 60
    # Continuation lines use 4-space indent
    continuation = result.split("\n")[1]
    assert continuation.startswith("    ")


# --- _render_field_change with width ---


def test_render_field_change_wraps_transition_at_narrow_width() -> None:
    change = make_change(
        action="update",
        old={"key1": "value1", "key2": "value2"},
        new={"key1": "value1", "key2": "changed"},
    )

    result = _render_field_change("configuration", change, use_color=False, width=60)

    assert result is not None
    assert "\n" in result
    assert "-> " in result


def test_render_field_change_no_wrap_when_line_fits() -> None:
    change = make_change(action="update", old=1, new=2)

    result = _render_field_change("x", change, use_color=False, width=80)

    assert result is not None
    assert "\n" not in result


def test_render_field_change_no_wrap_below_min_width() -> None:
    """Width below _MIN_WRAP_WIDTH (60) disables smart wrapping."""
    change = make_change(
        action="update",
        old={"key1": "value1", "key2": "value2"},
        new={"key1": "value1", "key2": "changed"},
    )

    result = _render_field_change("configuration", change, use_color=False, width=40)

    assert result is not None
    # Should be single line (no smart wrapping at narrow width)
    assert "\n" not in result


def test_render_field_change_no_wrap_at_exact_boundary() -> None:
    """Line that exactly equals width should not wrap."""
    change = make_change(action="update", old="a", new="b")

    result = _render_field_change("f", change, use_color=False, width=None)
    assert result is not None
    line_len = len(result)

    # Now render at exact width — should not wrap
    result_exact = _render_field_change("f", change, use_color=False, width=line_len)

    assert result_exact is not None
    assert "\n" not in result_exact


def test_render_field_change_color_spans_wrapped_newline() -> None:
    change = make_change(
        action="update",
        old={"key1": "value1", "key2": "value2"},
        new={"key1": "value1", "key2": "changed"},
    )

    result = _render_field_change("configuration", change, use_color=True, width=60)

    assert result is not None
    assert "\n" in result
    # ANSI color at start, RESET at end — spans the newline
    assert RESET in result
    lines = result.split("\n")
    # First line should start with color code, last line should end with RESET
    assert "\033[" in lines[0]
    assert lines[-1].endswith(RESET)


def test_render_field_change_width_none_no_wrapping() -> None:
    """Default width=None produces same output as original behavior."""
    change = make_change(
        action="update",
        old={"key1": "value1", "key2": "value2"},
        new={"key1": "value1", "key2": "changed"},
    )

    result = _render_field_change("configuration", change, use_color=False, width=None)

    assert result is not None
    assert "\n" not in result


# --- render_text width integration ---


def test_render_text_default_width_matches_original(
    capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    """render_text with width detection disabled should produce identical output to the original."""
    monkeypatch.setattr("dagshund.terminal._supports_color", lambda: False)
    monkeypatch.setattr("dagshund.terminal._detect_terminal_width", lambda: 200)
    plan = plan_from_dict(
        {
            "plan": {
                "resources.jobs.etl_pipeline": {
                    "action": "update",
                    "changes": {
                        "owner": {"action": "update", "old": "alice@example.com", "new": "bob@example.com"},
                        "timeout": {"action": "update", "old": 3600, "new": 7200},
                    },
                },
            },
        }
    )

    render_text(plan)

    out = capsys.readouterr().out
    # At width=200, no wrapping should occur — all lines are single
    for line in out.strip().split("\n"):
        if line.strip():
            assert "\n" not in line  # each line in output is a single line


def test_render_text_narrow_width_wraps_transitions(
    capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("dagshund.terminal._supports_color", lambda: False)
    monkeypatch.setattr("dagshund.terminal._detect_terminal_width", lambda: 65)
    plan = plan_from_dict(
        {
            "plan": {
                "resources.jobs.etl_pipeline": {
                    "action": "update",
                    "changes": {
                        "config": {
                            "action": "update",
                            "old": {"key1": "value1", "key2": "value2"},
                            "new": {"key1": "changed1", "key2": "changed2"},
                        },
                    },
                },
            },
        }
    )

    render_text(plan)

    out = capsys.readouterr().out
    assert "-> " in out
    # The transition should be split across lines
    lines = out.strip().split("\n")
    transition_lines = [line for line in lines if "-> " in line]
    assert len(transition_lines) >= 1


# --- wheel suppression (--suppress-wheel-updates) ---


def _wheel_whl_change(old_version: str, new_version: str, distribution: str = "etl_lib") -> FieldChange:
    return make_change(
        "update",
        old=f"/Workspace/artifacts/.internal/{distribution}-{old_version}-py3-none-any.whl",
        new=f"/Workspace/artifacts/.internal/{distribution}-{new_version}-py3-none-any.whl",
    )


def test_render_resource_suppress_wheel_updates_collapses_to_summary() -> None:
    entry = make_resource(
        "resources.jobs.etl",
        action="update",
        changes={
            "tasks[task_key='ingest'].libraries[0].whl": _wheel_whl_change("0.1.0", "0.2.0"),
            "tasks[task_key='transform'].libraries[0].whl": _wheel_whl_change("0.1.0", "0.2.0"),
        },
    )

    lines = list(_render_resource("resources.jobs.etl", entry, use_color=False, suppress_wheel_updates=True))

    assert "      ~ wheel etl_lib updated: 0.1.0 -> 0.2.0 (2 tasks)" in lines
    assert not any(".whl" in line and "wheel" not in line for line in lines)


def test_render_resource_suppress_wheel_updates_keeps_non_wheel_changes_on_mixed_task() -> None:
    entry = make_resource(
        "resources.jobs.etl",
        action="update",
        changes={
            "tasks[task_key='report'].libraries[0].whl": _wheel_whl_change("0.1.0", "0.2.0"),
            "tasks[task_key='report'].notebook_task.notebook_path": make_change("update", old="/a", new="/b"),
        },
    )

    lines = list(_render_resource("resources.jobs.etl", entry, use_color=False, suppress_wheel_updates=True))

    assert any("notebook_task.notebook_path" in line for line in lines)
    assert not any("libraries[0].whl" in line for line in lines)
    assert "      ~ wheel etl_lib updated: 0.1.0 -> 0.2.0 (1 task)" in lines


def test_render_resource_suppress_wheel_updates_lists_each_distinct_wheel() -> None:
    entry = make_resource(
        "resources.jobs.etl",
        action="update",
        changes={
            "tasks[task_key='ingest'].libraries[0].whl": _wheel_whl_change("0.1.0", "0.2.0"),
            "tasks[task_key='enrich'].libraries[1].whl": _wheel_whl_change("1.4.0", "1.5.0", "scoring_lib"),
        },
    )

    lines = list(_render_resource("resources.jobs.etl", entry, use_color=False, suppress_wheel_updates=True))

    etl_index = lines.index("      ~ wheel etl_lib updated: 0.1.0 -> 0.2.0 (1 task)")
    scoring_index = lines.index("      ~ wheel scoring_lib updated: 1.4.0 -> 1.5.0 (1 task)")
    assert etl_index < scoring_index  # sorted by distribution


def test_render_resource_wheel_updates_visible_by_default() -> None:
    entry = make_resource(
        "resources.jobs.etl",
        action="update",
        changes={
            "tasks[task_key='ingest'].libraries[0].whl": _wheel_whl_change("0.1.0", "0.2.0"),
        },
    )

    lines = list(_render_resource("resources.jobs.etl", entry, use_color=False))

    assert any("libraries[0].whl" in line for line in lines)
    assert not any("wheel etl_lib updated" in line for line in lines)


def test_render_resource_suppress_keeps_different_distribution_swap_visible() -> None:
    entry = make_resource(
        "resources.jobs.etl",
        action="update",
        changes={
            "tasks[task_key='ingest'].libraries[0].whl": make_change(
                "update",
                old="/Workspace/artifacts/.internal/etl_lib-0.1.0-py3-none-any.whl",
                new="/Workspace/artifacts/.internal/other_lib-0.1.0-py3-none-any.whl",
            ),
        },
    )

    lines = list(_render_resource("resources.jobs.etl", entry, use_color=False, suppress_wheel_updates=True))

    assert any("libraries[0].whl" in line for line in lines)
    assert not any("wheel etl_lib updated" in line for line in lines)


def test_render_text_suppress_wheel_updates_end_to_end(capsys: pytest.CaptureFixture[str]) -> None:
    plan = make_plan(
        {
            "resources.jobs.etl": make_resource(
                "resources.jobs.etl",
                action="update",
                changes={
                    "tasks[task_key='ingest'].libraries[0].whl": _wheel_whl_change("0.1.0", "0.2.0"),
                },
            ),
        }
    )

    render_text(plan, suppress_wheel_updates=True)

    out = capsys.readouterr().out
    assert "wheel etl_lib updated: 0.1.0 -> 0.2.0 (1 task)" in out
    assert "libraries[0].whl" not in out


def test_render_text_suppress_wheel_updates_wheel_bump_fixture(
    fixtures_dir: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    """End-to-end against the real mixed-compute golden plan (dagshund-aqcx, dagshund-vuoy)."""
    plan = plan_from_dict(json.loads((fixtures_dir / "wheel-bump" / "plan.json").read_text()))

    render_text(plan, suppress_wheel_updates=True)

    out = capsys.readouterr().out
    assert "wheel etl_lib updated: 0.1.0 -> 0.2.0 (14 tasks, 2 environments)" in out
    assert "wheel scoring_lib updated: 1.0.0 -> 1.1.0 (1 task, 1 environment)" in out
    assert "spec.dependencies" not in out
    assert ".libraries[0].whl" not in out
    assert "tasks[task_key='archive']" in out  # real changes stay visible
    assert "tasks[task_key='validate_orders'].timeout_seconds" in out
    assert "tasks[task_key='aggregate'].libraries" in out  # added wheel, not a bump


# --- render_text job_runs effects (dagshund-ocb1) ---


def test_render_text_effect_lines_render_for_skip_parent(capsys: pytest.CaptureFixture[str]) -> None:
    plan = plan_from_dict(
        {
            "plan": {
                "resources.jobs.etl": {"action": "skip", "remote_state": {"job_id": 100}},
                "resources.job_runs.nightly": {
                    "depends_on": [{"node": "resources.jobs.etl"}],
                    "action": "create",
                    "new_state": {"value": {"job_id": 100}},
                },
            }
        }
    )

    render_text(plan)

    out = capsys.readouterr().out
    assert "      + run nightly (runs on deploy)" in out
    # Effect entries never render as standalone resources
    assert "job_runs/" not in out


def test_render_text_effect_field_changes_render_indented(capsys: pytest.CaptureFixture[str]) -> None:
    plan = plan_from_dict(
        {
            "plan": {
                "resources.jobs.etl": {"action": "skip", "remote_state": {"job_id": 100}},
                "resources.job_runs.migrate": {
                    "depends_on": [{"node": "resources.jobs.etl"}],
                    "action": "recreate",
                    "changes": {
                        "job_parameters['v']": {"action": "recreate", "old": "1", "new": "2"},
                    },
                },
            }
        }
    )

    render_text(plan)

    out = capsys.readouterr().out
    assert "      ~ run migrate (re-runs on deploy)" in out
    assert '          ~ job_parameters[\'v\']: "1" -> "2"' in out


def test_render_text_delete_effect_uses_destructive_wording(capsys: pytest.CaptureFixture[str]) -> None:
    plan = plan_from_dict(
        {
            "plan": {
                "resources.jobs.etl": {"action": "skip", "remote_state": {"job_id": 100}},
                "resources.job_runs.audit": {
                    "depends_on": [{"node": "resources.jobs.etl"}],
                    "action": "delete",
                    "remote_state": {"job_id": 100, "run_id": 7},
                },
            }
        }
    )

    render_text(plan)

    out = capsys.readouterr().out
    assert "      - run audit (run record will be deleted)" in out


def test_render_text_effect_only_plan_is_not_no_changes(capsys: pytest.CaptureFixture[str]) -> None:
    plan = plan_from_dict(
        {
            "plan": {
                "resources.jobs.etl": {"action": "skip", "remote_state": {"job_id": 100}},
                "resources.job_runs.nightly": {
                    "depends_on": [{"node": "resources.jobs.etl"}],
                    "action": "create",
                },
            }
        }
    )

    render_text(plan)

    out = capsys.readouterr().out
    assert "No changes" not in out


def test_render_text_skip_only_effects_render_run_records(capsys: pytest.CaptureFixture[str]) -> None:
    """Skip-only effects are not changes (exit stays 0), but their run records still render."""
    plan = plan_from_dict(
        {
            "plan": {
                "resources.jobs.etl": {"action": "skip", "remote_state": {"job_id": 100}},
                "resources.job_runs.nightly": {
                    "depends_on": [{"node": "resources.jobs.etl"}],
                    "action": "skip",
                    "remote_state": {"job_id": 100, "run_id": 7},
                },
            }
        }
    )

    render_text(plan)

    out = capsys.readouterr().out
    assert "No changes" not in out
    assert "      = run nightly (already ran)" in out


def test_render_text_summary_includes_effect_tally(capsys: pytest.CaptureFixture[str]) -> None:
    plan = plan_from_dict(
        {
            "plan": {
                "resources.jobs.etl": {"action": "skip", "remote_state": {"job_id": 100}},
                "resources.job_runs.nightly": {
                    "depends_on": [{"node": "resources.jobs.etl"}],
                    "action": "create",
                },
                "resources.job_runs.audit": {
                    "depends_on": [{"node": "resources.jobs.etl"}],
                    "action": "delete",
                    "remote_state": {"job_id": 100, "run_id": 7},
                },
            }
        }
    )

    render_text(plan)

    out = capsys.readouterr().out
    assert "  =1 unchanged" in out
    assert "  runs: +1 create, -1 delete" in out


def test_render_resource_wraps_long_effect_field_values() -> None:
    resources = resources_from_dict(
        {
            "resources.jobs.etl": {"action": "skip", "remote_state": {"job_id": 100}},
            "resources.job_runs.migrate": {
                "depends_on": [{"node": "resources.jobs.etl"}],
                "action": "recreate",
                "changes": {
                    # 38-char values stay under the long-string "..." collapse
                    # (>40) while the combined transition line exceeds width.
                    "job_parameters['payload']": {
                        "action": "recreate",
                        "old": "x" * 38,
                        "new": "y" * 38,
                    },
                },
            },
        }
    )
    entry = normalize_plan(resources)["resources.jobs.etl"]

    lines = list(_render_resource("resources.jobs.etl", entry, use_color=False, width=80))

    wrapped = next(line for line in lines if "job_parameters['payload']" in line)
    first, continuation = wrapped.split("\n")
    # Effect field changes re-indent by 4; the wrapped transition's
    # continuation aligns to the block indent (10) plus that extra 4.
    assert first.startswith("          ~ job_parameters['payload']")
    assert continuation.startswith(f"{' ' * 14}->")
