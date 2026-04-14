import json
import os
import sys
from pathlib import Path

import pytest

from dagshund import (
    DagshundError,
    DiffState,
    action_to_diff_state,
    detect_changes,
    is_sub_resource_key,
    merge_sub_resources,
    parse_resource_key,
)
from dagshund.format import (
    ACTIONS,
    DEFAULT_ACTION,
    ActionConfig,
    DriftSummary,
    _extract_drift_label_noun,
    _summarize_resource_drift,
    action_config,
    collect_drift_summaries,
    collect_warnings,
    count_by_action,
    detect_drift_fields,
    detect_drift_reentries,
    filter_resources,
    format_display_value,
    format_group_header,
    format_transition,
    format_value,
    group_by_resource_type,
    is_long_string,
    iter_non_topology_field_changes,
)
from dagshund.plan import DANGEROUS_ACTIONS, STATEFUL_RESOURCE_TYPES
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

# --- is_sub_resource_key ---


@pytest.mark.parametrize(
    ("key", "expected"),
    [
        ("resources.jobs.test_job", False),
        ("resources.jobs.test_job.permissions", True),
        ("resources.jobs.test_job.grants.extra", True),
        ("resources.jobs", False),
        ("resources", False),
        ("", False),
    ],
    ids=["three_segments", "four_segments", "five_segments", "two_segments", "one_segment", "empty"],
)
def test_is_sub_resource_key(key: str, *, expected: bool) -> None:
    assert is_sub_resource_key(key) == expected


# --- render_text merges sub-resources (integration) ---


def test_render_text_merges_sub_resources(capsys: pytest.CaptureFixture[str]) -> None:
    plan = {
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

    render_text(plan)

    out = capsys.readouterr().out
    assert "test_job" in out
    # Parent promoted to update, so prefixed changes from permissions are visible
    assert "permissions.permissions[group_name='users'].permission_level" in out
    # Sub-resource keys don't appear as separate entries
    assert "permissions/" not in out


def test_detect_changes_true_after_merge_promotes_parent() -> None:
    resources = {
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


# --- action_config ---


@pytest.mark.parametrize(
    ("action", "expected"),
    [
        ("create", ActionConfig("create", "+")),
        ("delete", ActionConfig("delete", "-")),
        ("update", ActionConfig("update", "~", show_field_changes=True)),
        ("recreate", ActionConfig("recreate", "~", show_field_changes=True)),
        ("resize", ActionConfig("resize", "~", show_field_changes=True)),
        ("update_id", ActionConfig("update_id", "~", show_field_changes=True)),
        ("skip", ActionConfig("unchanged", "=")),
        ("", ActionConfig("unchanged", "=")),
        ("unknown_action", DEFAULT_ACTION),
    ],
    ids=[
        "create",
        "delete",
        "update",
        "recreate",
        "resize",
        "update_id",
        "skip",
        "empty",
        "unknown",
    ],
)
def test_action_config(action: str, expected: ActionConfig) -> None:
    assert action_config(action) == expected


def test_actions_table_covers_all_update_actions() -> None:
    update_configs = [cfg for cfg in ACTIONS.values() if cfg.show_field_changes]
    assert len(update_configs) == 4


# --- parse_resource_key ---


@pytest.mark.parametrize(
    ("key", "expected"),
    [
        ("resources.jobs.etl_pipeline", ("jobs", "etl_pipeline")),
        ("resources.jobs.pipeline.extra", ("jobs", "pipeline.extra")),
        ("jobs.etl_pipeline", ("jobs", "etl_pipeline")),
        ("standalone", ("", "standalone")),
        ("", ("", "")),
    ],
    ids=["three_parts", "dotted_name", "two_parts", "one_part", "empty_string"],
)
def test_parse_resource_key(key: str, expected: tuple[str, str]) -> None:
    assert parse_resource_key(key) == expected


# --- format_value ---


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (None, "null"),
        ("hello", '"hello"'),
        (True, "true"),
        (False, "false"),
        (42, "42"),
        (3.14, "3.14"),
        ({"a": 1, "b": 2}, "{a: 1, b: 2}"),
        ({}, "{}"),
        ([1, 2, 3], "[1, 2, 3]"),
        ([], "[]"),
    ],
    ids=["none", "string", "true", "false", "int", "float", "dict", "empty_dict", "list", "empty_list"],
)
def test_format_value(value: object, expected: str) -> None:
    assert format_value(value) == expected


def test_format_value_long_string_not_truncated() -> None:
    """format_value no longer truncates — is_long_string guards in the caller instead."""
    result = format_value("a" * 100)

    assert result == f'"{"a" * 100}"'


def test_format_value_unknown_type_uses_repr() -> None:
    result = format_value(object())
    assert result.startswith("<")


# --- format_transition ---


def test_format_transition_large_dict_collapses_both_sides() -> None:
    big = {"a": "x" * 30, "b": "y" * 30}

    result = format_transition(big, big)

    assert result == ": {2 fields} -> {2 fields}"


# --- is_long_string ---


def test_is_long_string_boundary_40_not_long() -> None:
    assert is_long_string("a" * 40) is False


def test_is_long_string_boundary_41_is_long() -> None:
    assert is_long_string("a" * 41) is True


def test_is_long_string_empty_string() -> None:
    assert is_long_string("") is False


def test_is_long_string_non_string_types() -> None:
    assert is_long_string(None) is False
    assert is_long_string(42) is False
    assert is_long_string(True) is False
    assert is_long_string({"key": "value"}) is False
    assert is_long_string([1, 2, 3]) is False


def test_render_field_change_large_dict_shows_summary() -> None:
    """Large dict in a field add shows a summary instead of full content."""
    large_dict = {
        "job_id": 0,
        "job_parameters": {
            "job_id": "{{job.parameters.job_id}}",
            "job_run_id": "{{job.parameters.job_run_id}}",
        },
    }
    change = {"action": "create", "new": large_dict}

    result = _render_field_change("run_job_task", change, use_color=False)

    assert result is not None
    assert "{2 fields}" in result
    assert "\n" not in result


# --- _render_field_change ---


def test_render_field_change_long_old_and_new_shows_ellipsis() -> None:
    change = {"action": "update", "old": "a" * 50, "new": "b" * 50}

    result = _render_field_change("field", change, use_color=False)

    assert result is not None
    assert "... -> ..." in result


def test_render_field_change_long_new_short_old_preserves_short() -> None:
    change = {"action": "update", "old": None, "new": "a" * 50}

    result = _render_field_change("field", change, use_color=False)

    assert result is not None
    assert "null -> ..." in result


def test_render_field_change_long_old_short_new_preserves_short() -> None:
    change = {"action": "update", "old": "a" * 50, "new": 42}

    result = _render_field_change("field", change, use_color=False)

    assert result is not None
    assert "... -> 42" in result


def test_render_field_change_short_string_old_long_new_preserves_short() -> None:
    change = {"action": "update", "old": "short text", "new": "a" * 50}

    result = _render_field_change("field", change, use_color=False)

    assert result is not None
    assert '"short text" -> ...' in result


def test_render_field_change_long_old_null_new_preserves_null() -> None:
    change = {"action": "update", "old": "a" * 50, "new": None}

    result = _render_field_change("field", change, use_color=False)

    assert result is not None
    assert "... -> null" in result


def test_render_field_change_long_new_only_shows_ellipsis() -> None:
    change = {"action": "create", "new": "a" * 50}

    result = _render_field_change("field", change, use_color=False)

    assert result is not None
    assert ": ..." in result


def test_render_field_change_short_values_show_inline() -> None:
    change = {"action": "update", "old": "short", "new": "also short"}

    result = _render_field_change("field", change, use_color=False)

    assert result is not None
    assert '"short" -> "also short"' in result


def test_render_field_change_long_old_missing_new_shows_ellipsis() -> None:
    change = {"action": "delete", "old": "a" * 50}

    result = _render_field_change("field", change, use_color=False)

    assert result is not None
    assert ": ..." in result
    assert "->" not in result


def test_render_field_change_dict_old_long_new_preserves_dict() -> None:
    change = {"action": "update", "old": {"a": 1}, "new": "b" * 50}

    result = _render_field_change("field", change, use_color=False)

    assert result is not None
    assert "{a: 1} -> ..." in result


def test_render_field_change_no_old_no_new_shows_field_only() -> None:
    change = {"action": "update"}

    result = _render_field_change("field", change, use_color=False)

    assert result is not None
    assert result.strip() == "~ field"


def test_render_field_change_unchanged_returns_none() -> None:
    change = {"action": "skip"}

    result = _render_field_change("field", change, use_color=False)

    assert result is None


def test_render_field_change_drift_shows_remote_to_new() -> None:
    change = {"action": "update", "old": "UI_LOCKED", "new": "UI_LOCKED", "remote": "EDITABLE"}

    result = _render_field_change("edit_mode", change, use_color=False)

    assert result is not None
    assert '"EDITABLE" -> "UI_LOCKED"' in result
    assert "(drift)" in result


def test_render_field_change_noop_old_equals_new_no_remote_suppressed() -> None:
    change = {"action": "update", "old": {"key": "val"}, "new": {"key": "val"}}

    result = _render_field_change("task", change, use_color=False)

    assert result is None


def test_render_field_change_noop_old_equals_new_equals_remote_suppressed() -> None:
    change = {"action": "update", "old": "A", "new": "A", "remote": "A"}

    result = _render_field_change("field", change, use_color=False)

    assert result is None


def test_render_field_change_remote_only_shows_remote_value() -> None:
    change = {"action": "update", "remote": {"no_alert": False}}

    result = _render_field_change("email_notifications", change, use_color=False)

    assert result is not None
    assert "{no_alert: false}" in result
    assert "(remote)" in result


def test_render_field_change_remote_only_scalar_shows_value() -> None:
    change = {"action": "update", "remote": "PERFORMANCE_OPTIMIZED"}

    result = _render_field_change("performance_target", change, use_color=False)

    assert result is not None
    assert '"PERFORMANCE_OPTIMIZED"' in result
    assert "(remote)" in result


def test_render_field_change_remote_only_shows_remote_symbol() -> None:
    """Field with action='update' but only 'remote' should show '=' not '~'."""
    change = {"action": "update", "remote": "PERFORMANCE_OPTIMIZED"}

    result = _render_field_change("performance_target", change, use_color=False)

    assert result is not None
    assert result.strip().startswith("=")


def test_render_field_change_update_new_only_shows_create_symbol() -> None:
    """Field with action='update' but only 'new' should show '+' not '~'."""
    change = {"action": "update", "new": {"job_id": 0, "task_key": "my_task"}}

    result = _render_field_change("tasks[task_key='my_task']", change, use_color=False)

    assert result is not None
    assert result.strip().startswith("+")


def test_render_field_change_update_old_only_shows_delete_symbol() -> None:
    """Field with action='update' but only 'old' should show '-' not '~'."""
    change = {"action": "update", "old": "removed_value"}

    result = _render_field_change("deprecated_field", change, use_color=False)

    assert result is not None
    assert result.strip().startswith("-")


def test_render_field_change_update_both_old_and_new_shows_update_symbol() -> None:
    """Field with action='update' and both 'old' and 'new' keeps '~'."""
    change = {"action": "update", "old": "before", "new": "after"}

    result = _render_field_change("field", change, use_color=False)

    assert result is not None
    assert result.strip().startswith("~")


# --- _render_resource ---


def test_render_resource_create_action() -> None:
    lines = list(_render_resource("resources.jobs.etl", {"action": "create"}, use_color=False))

    assert len(lines) == 1
    assert "+ jobs/etl" in lines[0]
    assert "(create)" in lines[0]


def test_render_resource_delete_action() -> None:
    lines = list(_render_resource("resources.jobs.old", {"action": "delete"}, use_color=False))

    assert "- jobs/old" in lines[0]
    assert "(delete)" in lines[0]


def test_render_resource_update_shows_field_changes() -> None:
    entry = {
        "action": "update",
        "changes": {
            "max_concurrent_runs": {"action": "update", "old": 1, "new": 5},
            "skipped_field": {"action": "skip"},
        },
    }

    lines = list(_render_resource("resources.jobs.pipeline", entry, use_color=False))

    assert "~ jobs/pipeline" in lines[0]
    assert "(update)" in lines[0]
    assert len(lines) == 2  # header + one field change (skip excluded)
    assert "max_concurrent_runs" in lines[1]
    assert "1 -> 5" in lines[1]


def test_render_resource_field_change_new_only() -> None:
    entry = {
        "action": "update",
        "changes": {"new_field": {"action": "create", "new": "value"}},
    }

    lines = list(_render_resource("resources.jobs.pipeline", entry, use_color=False))

    assert len(lines) == 2
    assert '"value"' in lines[1]


def test_render_resource_field_change_old_only() -> None:
    entry = {
        "action": "update",
        "changes": {"removed_field": {"action": "delete", "old": "gone"}},
    }

    lines = list(_render_resource("resources.jobs.pipeline", entry, use_color=False))

    assert len(lines) == 2
    assert '"gone"' in lines[1]


def test_render_resource_skip_action_omits_label() -> None:
    lines = list(_render_resource("resources.jobs.stable", {"action": "skip"}, use_color=False))

    assert "= jobs/stable" in lines[0]
    assert "(skip)" not in lines[0]
    assert "(unchanged)" not in lines[0]


def test_render_resource_empty_action_shows_unchanged() -> None:
    lines = list(_render_resource("resources.jobs.stable", {"action": ""}, use_color=False))

    assert "= jobs/stable" in lines[0]
    assert "(unchanged)" not in lines[0]


def test_render_resource_field_change_null_old_shows_transition() -> None:
    entry = {
        "action": "update",
        "changes": {"field": {"action": "update", "old": None, "new": "value"}},
    }

    lines = list(_render_resource("resources.jobs.pipeline", entry, use_color=False))

    assert len(lines) == 2
    assert "null" in lines[1]
    assert "->" in lines[1]
    assert '"value"' in lines[1]


def test_render_resource_field_change_null_new_shows_transition() -> None:
    entry = {
        "action": "update",
        "changes": {"field": {"action": "update", "old": "value", "new": None}},
    }

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
    entry = {
        "action": "update",
        "changes": {"field": {"action": "update", "old": None, "new": None}},
    }

    lines = list(_render_resource("resources.jobs.pipeline", entry, use_color=False))

    assert any("manually edited outside bundle" in line for line in lines)
    assert any("field" in line and "(re-added)" in line for line in lines)


def test_render_resource_with_color_includes_ansi() -> None:
    lines = list(_render_resource("resources.jobs.etl", {"action": "create"}, use_color=True))

    assert GREEN in lines[0]
    assert RESET in lines[0]


@pytest.mark.parametrize(
    "action",
    ["recreate", "resize", "update_id"],
    ids=["recreate", "resize", "update_id"],
)
def test_render_resource_update_action_shows_field_changes(action: str) -> None:
    entry = {
        "action": action,
        "changes": {"threshold": {"action": "update", "old": 10, "new": 20}},
    }

    lines = list(_render_resource("resources.jobs.pipeline", entry, use_color=False))

    assert f"({action})" in lines[0]
    assert "~ jobs/pipeline" in lines[0]
    assert len(lines) == 2
    assert "threshold" in lines[1]
    assert "10 -> 20" in lines[1]


def test_render_resource_field_change_no_old_no_new() -> None:
    entry = {
        "action": "update",
        "changes": {"mystery_field": {"action": "update"}},
    }

    lines = list(_render_resource("resources.jobs.pipeline", entry, use_color=False))

    assert len(lines) == 2
    assert "mystery_field" in lines[1]
    assert "->" not in lines[1]


def test_render_resource_field_change_missing_action_key() -> None:
    """Field change dict without an action key falls back to default (unchanged)."""
    entry = {
        "action": "update",
        "changes": {"orphan_field": {"old": 1, "new": 2}},
    }

    lines = list(_render_resource("resources.jobs.pipeline", entry, use_color=False))

    # Default action maps to DiffState.UNCHANGED, so field is filtered out
    assert len(lines) == 1


def test_render_resource_non_dict_changes_skips_field_details() -> None:
    entry = {"action": "update", "changes": "should_be_object"}

    lines = list(_render_resource("resources.jobs.etl", entry, use_color=False))

    assert len(lines) == 1
    assert "(update)" in lines[0]


def test_render_resource_non_dict_change_entry_skips_that_field() -> None:
    entry = {
        "action": "update",
        "changes": {
            "good_field": {"action": "update", "old": 1, "new": 2},
            "bad_field": "not_a_dict",
        },
    }

    lines = list(_render_resource("resources.jobs.etl", entry, use_color=False))

    assert len(lines) == 2
    assert "good_field" in lines[1]
    assert "bad_field" not in lines[1]


# --- count_by_action ---


def test_count_by_action_mixed() -> None:
    entries = {
        "a": {"action": "create"},
        "b": {"action": "create"},
        "c": {"action": "delete"},
        "d": {"action": "update"},
    }

    assert count_by_action(entries) == {
        action_config("create"): 2,
        action_config("delete"): 1,
        action_config("update"): 1,
    }


def test_count_by_action_skip_becomes_unchanged() -> None:
    entries = {"a": {"action": "skip"}, "b": {"action": "skip"}}
    assert count_by_action(entries) == {action_config("skip"): 2}


def test_count_by_action_empty_becomes_unchanged() -> None:
    entries = {"a": {"action": ""}, "b": {}}
    assert count_by_action(entries) == {action_config(""): 2}


def test_count_by_action_empty_input() -> None:
    assert count_by_action({}) == {}


# --- _print_header ---


def test_print_header_shows_version_info(capsys: pytest.CaptureFixture[str]) -> None:
    _print_header({"cli_version": "0.287.0", "plan_version": 2}, use_color=False)

    out = capsys.readouterr().out
    assert "v2" in out
    assert "0.287.0" in out


def test_print_header_defaults_when_missing(capsys: pytest.CaptureFixture[str]) -> None:
    _print_header({}, use_color=False)

    out = capsys.readouterr().out
    assert "unknown" in out
    assert "?" in out


# --- group_by_resource_type ---


def test_group_by_resource_type_groups_correctly() -> None:
    plan = {
        "resources.jobs.a": {"action": "create"},
        "resources.jobs.b": {"action": "delete"},
        "resources.schemas.c": {"action": "update"},
    }

    result = group_by_resource_type(plan)

    assert set(result.keys()) == {"jobs", "schemas"}
    assert len(result["jobs"]) == 2
    assert len(result["schemas"]) == 1


def test_group_by_resource_type_empty_plan() -> None:
    assert group_by_resource_type({}) == {}


# --- _print_resource_groups ---


def test_print_resource_groups_renders_type_header_and_entries(capsys: pytest.CaptureFixture[str]) -> None:
    by_type = {"jobs": {"resources.jobs.etl": {"action": "create"}}}

    _print_resource_groups(by_type, use_color=False)

    out = capsys.readouterr().out
    assert "jobs (1)" in out
    assert "+ jobs/etl" in out


def test_print_resource_groups_multiple_types(capsys: pytest.CaptureFixture[str]) -> None:
    by_type = {
        "alerts": {"resources.alerts.a": {"action": "delete"}},
        "jobs": {"resources.jobs.etl": {"action": "create"}},
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
    plan = {"a": {"action": "create"}, "b": {"action": "delete"}}

    _print_summary(plan, use_color=False)

    out = capsys.readouterr().out
    assert "+1 create" in out
    assert "-1 delete" in out


def test_print_summary_unchanged_uses_dim_style(capsys: pytest.CaptureFixture[str]) -> None:
    plan = {"a": {"action": "create"}, "b": {"action": "skip"}}

    _print_summary(plan, use_color=False)

    out = capsys.readouterr().out
    assert "=1 unchanged" in out
    assert "?" not in out


def test_print_summary_empty_plan(capsys: pytest.CaptureFixture[str]) -> None:
    _print_summary({}, use_color=False)

    out = capsys.readouterr().out
    assert out.strip() == ""


def test_print_summary_all_same_action(capsys: pytest.CaptureFixture[str]) -> None:
    plan = {"a": {"action": "create"}, "b": {"action": "create"}}

    _print_summary(plan, use_color=False)

    out = capsys.readouterr().out
    assert "+2 create" in out
    assert "," not in out  # only one action type, no comma separator


# --- render_text (integration) ---


def test_render_text_non_dict_plan_raises_error() -> None:
    with pytest.raises(DagshundError, match="plan must be an object"):
        render_text({"plan": "not_a_dict"})


def test_render_text_list_plan_raises_error() -> None:
    with pytest.raises(DagshundError, match="plan must be an object"):
        render_text({"plan": [1, 2, 3]})


def test_render_text_empty_plan_raises_error() -> None:
    with pytest.raises(DagshundError, match="plan is empty"):
        render_text({"plan": {}})


def test_render_text_missing_plan_key_raises_error() -> None:
    with pytest.raises(DagshundError, match="plan is empty"):
        render_text({"cli_version": "1.0"})


def test_render_text_all_unchanged_shows_no_changes(fixtures_dir: Path, capsys: pytest.CaptureFixture[str]) -> None:
    plan = json.loads((fixtures_dir / "no-changes" / "plan.json").read_text())

    render_text(plan)

    out = capsys.readouterr().out
    assert "No changes" in out
    assert "5 resources unchanged" in out
    # Should NOT list individual resources
    assert "alerts" not in out
    assert "(skip)" not in out
    assert "(unchanged)" not in out


def test_render_text_real_fixture(real_plan_json: str, capsys: pytest.CaptureFixture[str]) -> None:
    render_text(json.loads(real_plan_json))

    out = capsys.readouterr().out
    assert "etl_pipeline" in out
    assert "create" in out
    assert "update" in out
    assert "delete" in out
    assert "jobs" in out
    assert "alerts" in out


def test_render_text_mixed_plan_fixture(fixtures_dir: Path, capsys: pytest.CaptureFixture[str]) -> None:
    plan = json.loads((fixtures_dir / "mixed-changes" / "plan.json").read_text())

    render_text(plan)

    out = capsys.readouterr().out
    assert "create" in out
    assert "delete" in out
    assert "update" in out


def test_render_text_sample_plan_fixture(fixtures_dir: Path, capsys: pytest.CaptureFixture[str]) -> None:
    plan = json.loads((fixtures_dir / "all-create" / "plan.json").read_text())

    render_text(plan)

    out = capsys.readouterr().out
    assert "etl_pipeline" in out
    assert "create" in out


def test_render_text_invalid_plan_fixture(fixtures_dir: Path, capsys: pytest.CaptureFixture[str]) -> None:
    plan = json.loads((fixtures_dir / "invalid-plan.json").read_text())

    render_text(plan)

    out = capsys.readouterr().out
    assert "some_resource" in out


def test_render_text_force_color_includes_ansi(
    monkeypatch: pytest.MonkeyPatch, real_plan_json: str, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.delenv("NO_COLOR", raising=False)
    monkeypatch.setenv("FORCE_COLOR", "1")

    render_text(json.loads(real_plan_json))

    out = capsys.readouterr().out
    assert RESET in out


def test_render_text_no_color_excludes_ansi(
    monkeypatch: pytest.MonkeyPatch, real_plan_json: str, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setenv("NO_COLOR", "")

    render_text(json.loads(real_plan_json))

    out = capsys.readouterr().out
    assert RESET not in out


# --- action_to_diff_state ---


@pytest.mark.parametrize(
    ("action", "expected"),
    [
        ("create", DiffState.ADDED),
        ("delete", DiffState.REMOVED),
        ("update", DiffState.MODIFIED),
        ("recreate", DiffState.MODIFIED),
        ("resize", DiffState.MODIFIED),
        ("update_id", DiffState.MODIFIED),
        ("skip", DiffState.UNCHANGED),
        ("", DiffState.UNCHANGED),
        ("unknown_action", DiffState.UNKNOWN),
    ],
    ids=["create", "delete", "update", "recreate", "resize", "update_id", "skip", "empty", "unknown"],
)
def test_action_to_diff_state(action: str, expected: DiffState) -> None:
    assert action_to_diff_state(action) == expected


def test_all_diff_states_reachable_from_actions() -> None:
    """Every defined diff state except UNKNOWN must be reachable from a known action."""
    reachable = {action_to_diff_state(action) for action in ACTIONS}
    assert reachable == set(DiffState) - {DiffState.UNKNOWN}


# --- filter_resources ---


def test_filter_resources_by_state_keeps_matching() -> None:
    entries = {
        "resources.jobs.a": {"action": "create"},
        "resources.jobs.b": {"action": "skip"},
        "resources.jobs.c": {"action": "delete"},
    }

    result = filter_resources(entries, visible_states=frozenset({DiffState.ADDED}))

    assert list(result.keys()) == ["resources.jobs.a"]


def test_filter_resources_by_state_multiple_states() -> None:
    entries = {
        "resources.jobs.a": {"action": "create"},
        "resources.jobs.b": {"action": "delete"},
        "resources.jobs.c": {"action": "skip"},
    }

    result = filter_resources(entries, visible_states=frozenset({DiffState.ADDED, DiffState.REMOVED}))

    assert set(result.keys()) == {"resources.jobs.a", "resources.jobs.b"}


def test_filter_resources_by_state_returns_empty_when_none_match() -> None:
    entries = {"resources.jobs.a": {"action": "skip"}}

    result = filter_resources(entries, visible_states=frozenset({DiffState.ADDED}))

    assert result == {}


def test_filter_resources_by_state_modified_includes_all_update_actions() -> None:
    entries = {
        "resources.jobs.a": {"action": "update"},
        "resources.jobs.b": {"action": "recreate"},
        "resources.jobs.c": {"action": "resize"},
        "resources.jobs.d": {"action": "update_id"},
        "resources.jobs.e": {"action": "skip"},
    }

    result = filter_resources(entries, visible_states=frozenset({DiffState.MODIFIED}))

    assert len(result) == 4
    assert "resources.jobs.e" not in result


def test_filter_resources_by_predicate_keeps_matching() -> None:
    entries = {
        "resources.jobs.a": {"action": "create"},
        "resources.jobs.b": {"action": "skip"},
    }

    result = filter_resources(entries, resource_filter=lambda k, _v: "jobs.a" in k)

    assert list(result.keys()) == ["resources.jobs.a"]


def test_filter_resources_both_filters_compose_as_and() -> None:
    entries = {
        "resources.jobs.a": {"action": "create"},
        "resources.jobs.b": {"action": "create"},
        "resources.jobs.c": {"action": "skip"},
    }

    result = filter_resources(
        entries,
        visible_states=frozenset({DiffState.ADDED}),
        resource_filter=lambda k, _v: "jobs.b" in k,
    )

    assert list(result.keys()) == ["resources.jobs.b"]


# --- format_group_header ---


def test_format_group_header_all_visible() -> None:
    assert format_group_header("jobs", 3, 3) == "jobs (3)"


def test_format_group_header_partial_visible() -> None:
    assert format_group_header("experiments", 3, 1) == "experiments (1/3)"


# --- _print_resource_groups with visible_states ---


def test_print_resource_groups_visible_states_hides_unchanged_groups(
    capsys: pytest.CaptureFixture[str],
) -> None:
    by_type = {
        "jobs": {"resources.jobs.a": {"action": "skip"}, "resources.jobs.b": {"action": "skip"}},
        "alerts": {"resources.alerts.a": {"action": "create"}},
    }

    _print_resource_groups(by_type, use_color=False, visible_states=frozenset({DiffState.ADDED}))

    out = capsys.readouterr().out
    assert "alerts" in out
    assert "jobs" not in out


def test_print_resource_groups_visible_states_shows_partial_count(
    capsys: pytest.CaptureFixture[str],
) -> None:
    by_type = {
        "experiments": {
            "resources.experiments.a": {"action": "skip"},
            "resources.experiments.b": {"action": "create"},
        },
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
        "jobs": {"resources.jobs.a": {"action": "skip"}, "resources.jobs.b": {"action": "create"}},
    }

    _print_resource_groups(by_type, use_color=False)

    out = capsys.readouterr().out
    assert "jobs (2)" in out
    assert "jobs/a" in out
    assert "jobs/b" in out


# --- render_text with visible_states (integration) ---


def test_render_text_changes_only_hides_unchanged(fixtures_dir: Path, capsys: pytest.CaptureFixture[str]) -> None:
    plan = json.loads((fixtures_dir / "mixed-changes" / "plan.json").read_text())
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
    plan = json.loads((fixtures_dir / "mixed-changes" / "plan.json").read_text())

    render_text(plan, visible_states=frozenset({DiffState.ADDED}))

    out = capsys.readouterr().out
    assert "experiments/audit_analysis_final" in out
    assert "(create)" in out
    # No modified or deleted
    assert "alerts/stale_pipeline_alert" not in out
    assert "volumes/old_exports" not in out


def test_render_text_removed_only_shows_deletes(fixtures_dir: Path, capsys: pytest.CaptureFixture[str]) -> None:
    plan = json.loads((fixtures_dir / "mixed-changes" / "plan.json").read_text())

    render_text(plan, visible_states=frozenset({DiffState.REMOVED}))

    out = capsys.readouterr().out
    assert "volumes/old_exports" in out
    assert "(delete)" in out
    assert "experiments" not in out


def test_render_text_no_visible_states_shows_everything(fixtures_dir: Path, capsys: pytest.CaptureFixture[str]) -> None:
    plan = json.loads((fixtures_dir / "mixed-changes" / "plan.json").read_text())

    render_text(plan)

    out = capsys.readouterr().out
    assert "jobs" in out
    assert "schemas" in out
    assert "alerts" in out


# --- collect_warnings ---


def test_collect_warnings_detects_stateful_delete() -> None:
    resources = {"resources.volumes.imports": {"action": "delete"}}

    warnings = collect_warnings(resources)

    assert len(warnings) == 1
    assert "volumes/imports" in warnings[0]
    assert "deleted" in warnings[0]
    assert "all files in this volume will be lost" in warnings[0]


def test_collect_warnings_detects_stateful_recreate() -> None:
    resources = {"resources.schemas.analytics": {"action": "recreate"}}

    warnings = collect_warnings(resources)

    assert len(warnings) == 1
    assert "schemas/analytics" in warnings[0]
    assert "recreated" in warnings[0]
    assert "all tables, views, and volumes in this schema will be lost" in warnings[0]


def test_collect_warnings_ignores_non_stateful_delete() -> None:
    resources = {"resources.jobs.etl": {"action": "delete"}}

    assert collect_warnings(resources) == []


def test_collect_warnings_ignores_stateful_update() -> None:
    resources = {"resources.schemas.analytics": {"action": "update"}}

    assert collect_warnings(resources) == []


def test_collect_warnings_ignores_stateful_skip() -> None:
    resources = {"resources.volumes.data": {"action": "skip"}}

    assert collect_warnings(resources) == []


@pytest.mark.parametrize(
    ("resource_type", "expected_risk"),
    [
        ("catalogs", "all schemas, tables, and volumes in this catalog"),
        ("schemas", "all tables, views, and volumes in this schema"),
        ("volumes", "all files in this volume"),
        ("registered_models", "all model versions"),
        ("experiments", "all experiment runs and metrics"),
        ("database_instances", "all catalogs and tables on this instance"),
        ("postgres_projects", "all branches and endpoints in this project"),
        ("postgres_branches", "all data on this branch"),
    ],
    ids=[
        "catalogs",
        "schemas",
        "volumes",
        "registered_models",
        "experiments",
        "database_instances",
        "postgres_projects",
        "postgres_branches",
    ],
)
def test_collect_warnings_all_stateful_types(resource_type: str, expected_risk: str) -> None:
    resources = {f"resources.{resource_type}.x": {"action": "delete"}}

    warnings = collect_warnings(resources)

    assert len(warnings) == 1
    assert expected_risk in warnings[0]


def test_collect_warnings_respects_visible_states_filter() -> None:
    resources = {
        "resources.volumes.imports": {"action": "delete"},
        "resources.schemas.analytics": {"action": "recreate"},
    }

    warnings = collect_warnings(resources, visible_states=frozenset({DiffState.REMOVED}))

    assert len(warnings) == 1
    assert "volumes/imports" in warnings[0]


def test_collect_warnings_empty_when_filtered_out() -> None:
    resources = {"resources.volumes.imports": {"action": "delete"}}

    assert collect_warnings(resources, visible_states=frozenset({DiffState.ADDED})) == []


def test_collect_warnings_multiple_sorted_by_key() -> None:
    resources = {
        "resources.volumes.z_data": {"action": "delete"},
        "resources.catalogs.a_main": {"action": "delete"},
    }

    warnings = collect_warnings(resources)

    assert len(warnings) == 2
    assert "catalogs/a_main" in warnings[0]
    assert "volumes/z_data" in warnings[1]


def test_collect_warnings_covers_all_dangerous_actions() -> None:
    """Every action in DANGEROUS_ACTIONS must trigger a warning on a stateful resource."""
    for action in DANGEROUS_ACTIONS:
        resources = {"resources.schemas.test": {"action": action}}
        assert collect_warnings(resources), f"action '{action}' should produce a warning"


def test_collect_warnings_covers_all_stateful_types() -> None:
    """Every type in STATEFUL_RESOURCE_TYPES must trigger a warning on delete."""
    for resource_type in STATEFUL_RESOURCE_TYPES:
        resources = {f"resources.{resource_type}.test": {"action": "delete"}}
        assert collect_warnings(resources), f"resource type '{resource_type}' should produce a warning"


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
    plan = json.loads((fixtures_dir / "mixed-changes" / "plan.json").read_text())

    render_text(plan)

    out = capsys.readouterr().out
    assert "\u26a0" in out
    assert "volumes/old_exports" in out
    assert "deleted" in out


def test_render_text_warning_appears_after_summary(fixtures_dir: Path, capsys: pytest.CaptureFixture[str]) -> None:
    plan = json.loads((fixtures_dir / "mixed-changes" / "plan.json").read_text())

    render_text(plan)

    out = capsys.readouterr().out
    summary_pos = out.index("create,")
    warning_pos = out.index("\u26a0")
    assert warning_pos > summary_pos


def test_render_text_no_warnings_for_safe_plan(capsys: pytest.CaptureFixture[str]) -> None:
    plan = {
        "plan_version": 2,
        "cli_version": "0.288.0",
        "plan": {
            "resources.jobs.etl": {"action": "delete"},
            "resources.alerts.old": {"action": "delete"},
        },
    }

    render_text(plan)

    out = capsys.readouterr().out
    assert "\u26a0" not in out


def test_render_text_warning_hidden_when_filtered_out(fixtures_dir: Path, capsys: pytest.CaptureFixture[str]) -> None:
    plan = json.loads((fixtures_dir / "mixed-changes" / "plan.json").read_text())

    render_text(plan, visible_states=frozenset({DiffState.ADDED}))

    out = capsys.readouterr().out
    assert "\u26a0" not in out


def test_render_text_schema_recreate_warns(capsys: pytest.CaptureFixture[str]) -> None:
    plan = {
        "plan_version": 2,
        "cli_version": "0.288.0",
        "plan": {
            "resources.schemas.analytics": {"action": "recreate"},
        },
    }

    render_text(plan)

    out = capsys.readouterr().out
    assert "\u26a0" in out
    assert "schemas/analytics" in out
    assert "recreated" in out


# --- detect_drift_fields ---


def test_detect_drift_fields_returns_empty_for_no_changes() -> None:
    assert detect_drift_fields(None) == []
    assert detect_drift_fields({}) == []


def test_detect_drift_fields_returns_empty_when_old_differs_from_new() -> None:
    changes = {"field": {"action": "update", "old": "a", "new": "b", "remote": "c"}}
    assert detect_drift_fields(changes) == []


def test_detect_drift_fields_returns_empty_when_old_equals_remote() -> None:
    changes = {"field": {"action": "update", "old": "a", "new": "a", "remote": "a"}}
    assert detect_drift_fields(changes) == []


def test_detect_drift_fields_detects_remote_differs_from_old() -> None:
    changes = {"edit_mode": {"action": "update", "old": "UI_LOCKED", "new": "UI_LOCKED", "remote": "EDITABLE"}}
    assert detect_drift_fields(changes) == ["edit_mode"]


def test_detect_drift_fields_remote_absent_not_drift() -> None:
    changes = {"task": {"action": "update", "old": {"task_key": "x"}, "new": {"task_key": "x"}}}
    assert detect_drift_fields(changes) == []


def test_detect_drift_fields_skips_skip_action() -> None:
    changes = {"field": {"action": "skip", "old": "a", "new": "a", "remote": "b"}}
    assert detect_drift_fields(changes) == []


def test_detect_drift_fields_skips_empty_action() -> None:
    changes = {"field": {"action": "", "old": "a", "new": "a", "remote": "b"}}
    assert detect_drift_fields(changes) == []


def test_detect_drift_fields_skips_entries_without_old() -> None:
    changes = {"field": {"action": "update", "new": "a", "remote": "b"}}
    assert detect_drift_fields(changes) == []


def test_detect_drift_fields_skips_entries_without_new() -> None:
    changes = {"field": {"action": "update", "old": "a", "remote": "b"}}
    assert detect_drift_fields(changes) == []


def test_detect_drift_fields_returns_multiple_sorted() -> None:
    changes = {
        "z_field": {"action": "update", "old": 1, "new": 1, "remote": 2},
        "a_field": {"action": "update", "old": "x", "new": "x", "remote": "y"},
    }
    assert detect_drift_fields(changes) == ["a_field", "z_field"]


# --- _render_resource with drift ---


def test_render_resource_shows_drift_warning_when_drift_detected() -> None:
    entry = {
        "action": "update",
        "changes": {
            "edit_mode": {"action": "update", "old": "UI_LOCKED", "new": "UI_LOCKED", "remote": "EDITABLE"},
        },
    }
    lines = list(_render_resource("resources.jobs.pipeline", entry, use_color=False))
    assert any("manually edited outside bundle" in line for line in lines)


def test_render_resource_no_drift_warning_for_create_action() -> None:
    entry = {
        "action": "create",
        "changes": {
            "edit_mode": {"action": "update", "old": "UI_LOCKED", "new": "UI_LOCKED", "remote": "EDITABLE"},
        },
    }
    lines = list(_render_resource("resources.jobs.pipeline", entry, use_color=False))
    assert not any("manually edited" in line for line in lines)


def test_render_resource_no_drift_warning_for_delete_action() -> None:
    entry = {
        "action": "delete",
        "changes": {
            "edit_mode": {"action": "update", "old": "UI_LOCKED", "new": "UI_LOCKED", "remote": "EDITABLE"},
        },
    }
    lines = list(_render_resource("resources.jobs.pipeline", entry, use_color=False))
    assert not any("manually edited" in line for line in lines)


def test_render_resource_no_drift_warning_when_no_drift() -> None:
    entry = {
        "action": "update",
        "changes": {
            "max_concurrent_runs": {"action": "update", "old": 1, "new": 5},
        },
    }
    lines = list(_render_resource("resources.jobs.pipeline", entry, use_color=False))
    assert not any("manually edited" in line for line in lines)


# --- _extract_drift_label_noun ---


@pytest.mark.parametrize(
    ("key", "expected"),
    [
        ("tasks[task_key='transform']", ("task", "transform")),
        ("grants.[principal='data_engineers']", ("grant", "data_engineers")),
        ("libraries[name='foo']", ("library", "foo")),
        ("job_clusters[job_cluster_key='main']", ("job_cluster", "main")),
        ("permissions[user_name='alice']", ("permission", "alice")),
        ("parameters[name='x']", ("parameter", "x")),
        ("environments[environment_key='prod']", ("environment", "prod")),
        ("[principal='x']", ("entity", "x")),
        ("foo.bar[name='baz']", ("bar", "baz")),
        ("simple_field", ("entity", "simple_field")),
    ],
)
def test_extract_drift_label_noun(key: str, expected: tuple[str, str]) -> None:
    assert _extract_drift_label_noun(key) == expected


# --- detect_drift_reentries ---


def test_detect_drift_reentries_empty_returns_empty_list() -> None:
    assert detect_drift_reentries({}) == []
    assert detect_drift_reentries(None) == []


def test_detect_drift_reentries_single_topology_drift_entry() -> None:
    changes = {
        "tasks[task_key='transform']": {
            "action": "update",
            "old": {"task_key": "transform"},
            "new": {"task_key": "transform"},
        },
    }
    assert detect_drift_reentries(changes) == [("task", "transform")]


def test_detect_drift_reentries_skips_field_drift_and_skip_actions() -> None:
    changes = {
        "tasks[task_key='transform']": {
            "action": "update",
            "old": {"task_key": "transform"},
            "new": {"task_key": "transform"},
        },
        "edit_mode": {"action": "update", "old": "UI", "new": "UI", "remote": "EDITABLE"},
        "noise": {"action": "skip", "remote": 0},
    }
    assert detect_drift_reentries(changes) == [("task", "transform")]


def test_detect_drift_reentries_sort_stability() -> None:
    """Insertion order must not bleed through — results are sorted by (noun, label)."""
    entry_zulu = {"action": "update", "old": {"x": 1}, "new": {"x": 1}}
    entry_alpha = {"action": "update", "old": {"y": 2}, "new": {"y": 2}}
    changes = {
        "tasks[task_key='zulu']": entry_zulu,
        "tasks[task_key='alpha']": entry_alpha,
    }
    assert detect_drift_reentries(changes) == [("task", "alpha"), ("task", "zulu")]


def test_detect_drift_reentries_multiple_same_noun() -> None:
    changes = {
        "tasks[task_key='alpha']": {"action": "update", "old": {"a": 1}, "new": {"a": 1}},
        "tasks[task_key='beta']": {"action": "update", "old": {"b": 2}, "new": {"b": 2}},
    }
    pairs = detect_drift_reentries(changes)
    assert pairs == [("task", "alpha"), ("task", "beta")]


# --- iter_non_topology_field_changes ---


def test_iter_non_topology_field_changes_sorts_and_skips_topology() -> None:
    changes = {
        "zeta": {"action": "update", "old": 1, "new": 2},
        "alpha": {"action": "update", "old": 3, "new": 4},
        "tasks[task_key='t']": {"action": "update", "old": {"a": 1}, "new": {"a": 1}},
    }
    result = list(iter_non_topology_field_changes(changes))
    assert [name for name, _ in result] == ["alpha", "zeta"]


def test_iter_non_topology_field_changes_retains_field_drift_entries() -> None:
    changes = {
        "edit_mode": {"action": "update", "old": "UI", "new": "UI", "remote": "EDITABLE"},
    }
    result = list(iter_non_topology_field_changes(changes))
    assert len(result) == 1
    assert result[0][0] == "edit_mode"


def test_iter_non_topology_field_changes_skips_non_dict_entries() -> None:
    # FieldChange is typed as dict, but the runtime check must still guard against it.
    changes: dict[str, object] = {"garbage": "not a dict", "real": {"action": "update", "old": 1, "new": 2}}
    result = list(iter_non_topology_field_changes(changes))  # type: ignore[arg-type]
    assert [name for name, _ in result] == ["real"]


# --- _summarize_resource_drift ---


def test_summarize_resource_drift_field_only() -> None:
    entry = {
        "action": "update",
        "changes": {
            "edit_mode": {"action": "update", "old": "X", "new": "X", "remote": "Y"},
            "field_b": {"action": "update", "old": 1, "new": 1, "remote": 2},
        },
    }
    summary = _summarize_resource_drift("resources.jobs.pipeline", entry)
    assert summary == DriftSummary(
        resource_type="jobs",
        resource_name="pipeline",
        overwritten_field_count=2,
        reentries=(),
    )


def test_summarize_resource_drift_topology_only() -> None:
    entry = {
        "action": "update",
        "changes": {
            "tasks[task_key='t']": {"action": "update", "old": {"a": 1}, "new": {"a": 1}},
        },
    }
    summary = _summarize_resource_drift("resources.jobs.pipeline", entry)
    assert summary is not None
    assert summary.overwritten_field_count == 0
    assert summary.reentries == (("task", "t"),)


def test_summarize_resource_drift_returns_none_for_no_drift() -> None:
    entry = {
        "action": "update",
        "changes": {"max_concurrent_runs": {"action": "update", "old": 1, "new": 5}},
    }
    assert _summarize_resource_drift("resources.jobs.pipeline", entry) is None


def test_summarize_resource_drift_returns_none_for_skip_only_changes() -> None:
    entry = {
        "action": "update",
        "changes": {
            "foo": {"action": "skip", "reason": "empty", "remote": {}},
            "bar": {"action": "skip", "reason": "backend_default", "remote": "X"},
        },
    }
    assert _summarize_resource_drift("resources.jobs.pipeline", entry) is None


# --- collect_drift_summaries ---


def test_collect_drift_summaries_field_only_resource() -> None:
    resources = {
        "resources.jobs.pipeline": {
            "action": "update",
            "changes": {
                "edit_mode": {"action": "update", "old": "UI", "new": "UI", "remote": "EDITABLE"},
                "field_b": {"action": "update", "old": 1, "new": 1, "remote": 2},
            },
        },
    }
    summaries = collect_drift_summaries(resources)
    assert len(summaries) == 1
    assert summaries[0].resource_type == "jobs"
    assert summaries[0].resource_name == "pipeline"
    assert summaries[0].overwritten_field_count == 2
    assert summaries[0].reentries == ()


def test_collect_drift_summaries_returns_empty_for_no_drift() -> None:
    resources = {
        "resources.jobs.pipeline": {
            "action": "update",
            "changes": {"max_concurrent_runs": {"action": "update", "old": 1, "new": 5}},
        },
    }
    assert collect_drift_summaries(resources) == []


def test_collect_drift_summaries_topology_only() -> None:
    resources = {
        "resources.jobs.pipeline": {
            "action": "update",
            "changes": {
                "tasks[task_key='t']": {"action": "update", "old": {"a": 1}, "new": {"a": 1}},
            },
        },
    }
    summaries = collect_drift_summaries(resources)
    assert len(summaries) == 1
    assert summaries[0].overwritten_field_count == 0
    assert len(summaries[0].reentries) == 1


def test_collect_drift_summaries_mixed_field_and_topology() -> None:
    resources = {
        "resources.jobs.pipeline": {
            "action": "update",
            "changes": {
                "edit_mode": {"action": "update", "old": "UI", "new": "UI", "remote": "EDITABLE"},
                "tasks[task_key='t']": {"action": "update", "old": {"a": 1}, "new": {"a": 1}},
            },
        },
    }
    summaries = collect_drift_summaries(resources)
    assert len(summaries) == 1
    assert summaries[0].overwritten_field_count == 1
    assert summaries[0].reentries == (("task", "t"),)


def test_collect_drift_summaries_respects_visible_states() -> None:
    resources = {
        "resources.jobs.pipeline": {
            "action": "update",
            "changes": {
                "edit_mode": {"action": "update", "old": "UI", "new": "UI", "remote": "EDITABLE"},
            },
        },
    }
    assert collect_drift_summaries(resources, visible_states=frozenset({DiffState.ADDED})) == []


def test_collect_drift_summaries_respects_resource_filter() -> None:
    resources = {
        "resources.jobs.pipeline": {
            "action": "update",
            "changes": {
                "edit_mode": {"action": "update", "old": "UI", "new": "UI", "remote": "EDITABLE"},
            },
        },
    }
    assert collect_drift_summaries(resources, resource_filter=lambda k, _: "other" in k) == []


# --- _render_resource topology drift ---


@pytest.mark.parametrize(
    ("change_key", "expected_token"),
    [
        ("tasks[task_key='transform']", "tasks[task_key='transform']"),
        ("grants.[principal='data_engineers']", "grants.[principal='data_engineers']"),
    ],
)
def test_render_resource_topology_drift_emits_single_reentry_line(change_key: str, expected_token: str) -> None:
    entry = {
        "action": "update",
        "changes": {
            change_key: {"action": "update", "old": {"x": 1}, "new": {"x": 1}},
        },
    }
    lines = list(_render_resource("resources.jobs.pipeline", entry, use_color=False))
    matching = [line for line in lines if expected_token in line]
    assert len(matching) == 1
    assert matching[0].endswith("(re-added)")
    assert "+" in matching[0]
    assert any("manually edited outside bundle" in line for line in lines)


def test_render_resource_mixed_field_and_topology_drift() -> None:
    entry = {
        "action": "update",
        "changes": {
            "edit_mode": {"action": "update", "old": "UI", "new": "UI", "remote": "EDITABLE"},
            "tasks[task_key='transform']": {"action": "update", "old": {"x": 1}, "new": {"x": 1}},
        },
    }
    lines = list(_render_resource("resources.jobs.pipeline", entry, use_color=False))
    assert any("manually edited outside bundle" in line for line in lines)
    assert any("edit_mode" in line and "(drift)" in line for line in lines)
    assert any("tasks[task_key='transform']" in line and "(re-added)" in line for line in lines)


def test_render_resource_topology_drift_not_emitted_under_create_action() -> None:
    entry = {
        "action": "create",
        "changes": {
            "tasks[task_key='transform']": {"action": "update", "old": {"x": 1}, "new": {"x": 1}},
        },
    }
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
    entry = {
        "action": "recreate",
        "changes": {
            "tasks[task_key='transform']": {"action": "recreate", "old": {"x": 1}, "new": {"x": 1}},
        },
    }
    lines = list(_render_resource("resources.jobs.pipeline", entry, use_color=False))
    assert not any("(re-added)" in line for line in lines)


# --- render_text drift integration ---


def test_render_text_shows_drift_section(capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("dagshund.terminal._supports_color", lambda: False)
    plan = {
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
    plan = {
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

    render_text(plan)

    out = capsys.readouterr().out
    assert "2 tasks will be re-added (alpha, beta)" in out


# --- format_display_value ---


def test_format_display_value_short_string_shows_quoted() -> None:
    assert format_display_value("hello") == '"hello"'


def test_format_display_value_long_string_shows_ellipsis() -> None:
    assert format_display_value("a" * 50) == "..."


def test_format_display_value_number_shows_inline() -> None:
    assert format_display_value(42) == "42"


def test_format_display_value_dict_shows_inline() -> None:
    assert format_display_value({"a": 1}) == "{a: 1}"


# --- _detect_terminal_width ---


def test_detect_terminal_width_returns_columns(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(os, "get_terminal_size", lambda: os.terminal_size((100, 24)))

    assert _detect_terminal_width() == 100


def test_detect_terminal_width_fallback_80_on_oserror(monkeypatch: pytest.MonkeyPatch) -> None:
    def raise_oserror() -> os.terminal_size:
        raise OSError("not a terminal")

    monkeypatch.setattr(os, "get_terminal_size", raise_oserror)

    assert _detect_terminal_width() == 80


def test_detect_terminal_width_fallback_80_on_value_error(monkeypatch: pytest.MonkeyPatch) -> None:
    def raise_value_error() -> os.terminal_size:
        raise ValueError("bad fd")

    monkeypatch.setattr(os, "get_terminal_size", raise_value_error)

    assert _detect_terminal_width() == 80


# --- _wrap_transition ---


def test_wrap_transition_normal_splits_at_arrow() -> None:
    prefix = "      ~ config"
    change = {"action": "update", "old": {"a": 1, "b": 2}, "new": {"a": 1, "b": 3}}

    result = _wrap_transition(prefix, change)

    assert result is not None
    lines = result.split("\n")
    assert len(lines) == 2
    assert lines[0] == "      ~ config: {a: 1, b: 2}"
    assert lines[1] == "          -> {a: 1, b: 3}"


def test_wrap_transition_drift_includes_annotation() -> None:
    prefix = "      ~ edit_mode"
    change = {"action": "update", "old": "UI_LOCKED", "new": "UI_LOCKED", "remote": "EDITABLE"}

    result = _wrap_transition(prefix, change)

    assert result is not None
    lines = result.split("\n")
    assert len(lines) == 2
    assert '"EDITABLE"' in lines[0]
    assert '-> "UI_LOCKED" (drift)' in lines[1]


def test_wrap_transition_returns_none_for_single_value() -> None:
    prefix = "      + field"
    change = {"action": "create", "new": "value"}

    assert _wrap_transition(prefix, change) is None


def test_wrap_transition_returns_none_for_noop() -> None:
    prefix = "      ~ field"
    change = {"action": "update", "old": "same", "new": "same"}

    assert _wrap_transition(prefix, change) is None


def test_wrap_transition_truncates_long_strings() -> None:
    prefix = "      ~ field"
    change = {"action": "update", "old": "a" * 50, "new": "b" * 50}

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
    change = {
        "action": "update",
        "old": {"key1": "value1", "key2": "value2"},
        "new": {"key1": "value1", "key2": "changed"},
    }

    result = _render_field_change("configuration", change, use_color=False, width=60)

    assert result is not None
    assert "\n" in result
    assert "-> " in result


def test_render_field_change_no_wrap_when_line_fits() -> None:
    change = {"action": "update", "old": 1, "new": 2}

    result = _render_field_change("x", change, use_color=False, width=80)

    assert result is not None
    assert "\n" not in result


def test_render_field_change_no_wrap_below_min_width() -> None:
    """Width below _MIN_WRAP_WIDTH (60) disables smart wrapping."""
    change = {
        "action": "update",
        "old": {"key1": "value1", "key2": "value2"},
        "new": {"key1": "value1", "key2": "changed"},
    }

    result = _render_field_change("configuration", change, use_color=False, width=40)

    assert result is not None
    # Should be single line (no smart wrapping at narrow width)
    assert "\n" not in result


def test_render_field_change_no_wrap_at_exact_boundary() -> None:
    """Line that exactly equals width should not wrap."""
    change = {"action": "update", "old": "a", "new": "b"}

    result = _render_field_change("f", change, use_color=False, width=None)
    assert result is not None
    line_len = len(result)

    # Now render at exact width — should not wrap
    result_exact = _render_field_change("f", change, use_color=False, width=line_len)

    assert result_exact is not None
    assert "\n" not in result_exact


def test_render_field_change_color_spans_wrapped_newline() -> None:
    change = {
        "action": "update",
        "old": {"key1": "value1", "key2": "value2"},
        "new": {"key1": "value1", "key2": "changed"},
    }

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
    change = {
        "action": "update",
        "old": {"key1": "value1", "key2": "value2"},
        "new": {"key1": "value1", "key2": "changed"},
    }

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
    plan = {
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
    plan = {
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

    render_text(plan)

    out = capsys.readouterr().out
    assert "-> " in out
    # The transition should be split across lines
    lines = out.strip().split("\n")
    transition_lines = [line for line in lines if "-> " in line]
    assert len(transition_lines) >= 1
