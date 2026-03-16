import json
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
from dagshund.text import (
    _ACTIONS,
    _DANGEROUS_ACTIONS,
    _DEFAULT_ACTION,
    _STATEFUL_RESOURCE_WARNINGS,
    DIM,
    GREEN,
    RED,
    RESET,
    YELLOW,
    _action_config,
    _ActionConfig,
    _collect_warnings,
    _colorize,
    _count_by_action,
    _filter_resources,
    _format_group_header,
    _format_value,
    _group_by_resource_type,
    _print_header,
    _print_resource_groups,
    _print_summary,
    _print_warnings,
    _render_resource,
    _supports_color,
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


# --- _action_config ---


@pytest.mark.parametrize(
    ("action", "expected"),
    [
        ("create", _ActionConfig("create", GREEN, "+")),
        ("delete", _ActionConfig("delete", RED, "-")),
        ("update", _ActionConfig("update", YELLOW, "~", show_field_changes=True)),
        ("recreate", _ActionConfig("recreate", YELLOW, "~", show_field_changes=True)),
        ("resize", _ActionConfig("resize", YELLOW, "~", show_field_changes=True)),
        ("update_id", _ActionConfig("update_id", YELLOW, "~", show_field_changes=True)),
        ("skip", _ActionConfig("unchanged", DIM, " ")),
        ("", _ActionConfig("unchanged", DIM, " ")),
        ("unknown_action", _DEFAULT_ACTION),
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
def test_action_config(action: str, expected: _ActionConfig) -> None:
    assert _action_config(action) == expected


def test_actions_table_covers_all_update_actions() -> None:
    update_configs = [cfg for cfg in _ACTIONS.values() if cfg.show_field_changes]
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


# --- _format_value ---


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (None, "null"),
        ("hello", '"hello"'),
        (True, "true"),
        (False, "false"),
        (42, "42"),
        (3.14, "3.14"),
        ({"a": 1, "b": 2}, "{2 fields}"),
        ({}, "{0 fields}"),
        ([1, 2, 3], "[3 items]"),
        ([], "[0 items]"),
    ],
    ids=["none", "string", "true", "false", "int", "float", "dict", "empty_dict", "list", "empty_list"],
)
def test_format_value(value: object, expected: str) -> None:
    assert _format_value(value) == expected


def test_format_value_boundary_80_chars_not_truncated() -> None:
    result = _format_value("a" * 80)

    assert result == f'"{"a" * 80}"'


def test_format_value_boundary_81_chars_truncated() -> None:
    result = _format_value("a" * 81)

    assert result == f'"{"a" * 77}..."'


def test_format_value_unknown_type_uses_repr() -> None:
    result = _format_value(object())
    assert result.startswith("<")


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

    assert "  jobs/stable" in lines[0]
    assert "(skip)" not in lines[0]
    assert "(unchanged)" not in lines[0]


def test_render_resource_empty_action_shows_unchanged() -> None:
    lines = list(_render_resource("resources.jobs.stable", {"action": ""}, use_color=False))

    assert "  jobs/stable" in lines[0]
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


def test_render_resource_field_change_both_null_shows_transition() -> None:
    entry = {
        "action": "update",
        "changes": {"field": {"action": "update", "old": None, "new": None}},
    }

    lines = list(_render_resource("resources.jobs.pipeline", entry, use_color=False))

    assert len(lines) == 2
    assert "null -> null" in lines[1]


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


# --- _count_by_action ---


def test_count_by_action_mixed() -> None:
    entries = {
        "a": {"action": "create"},
        "b": {"action": "create"},
        "c": {"action": "delete"},
        "d": {"action": "update"},
    }

    assert _count_by_action(entries) == {
        _action_config("create"): 2,
        _action_config("delete"): 1,
        _action_config("update"): 1,
    }


def test_count_by_action_skip_becomes_unchanged() -> None:
    entries = {"a": {"action": "skip"}, "b": {"action": "skip"}}
    assert _count_by_action(entries) == {_action_config("skip"): 2}


def test_count_by_action_empty_becomes_unchanged() -> None:
    entries = {"a": {"action": ""}, "b": {}}
    assert _count_by_action(entries) == {_action_config(""): 2}


def test_count_by_action_empty_input() -> None:
    assert _count_by_action({}) == {}


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


# --- _group_by_resource_type ---


def test_group_by_resource_type_groups_correctly() -> None:
    plan = {
        "resources.jobs.a": {"action": "create"},
        "resources.jobs.b": {"action": "delete"},
        "resources.schemas.c": {"action": "update"},
    }

    result = _group_by_resource_type(plan)

    assert set(result.keys()) == {"jobs", "schemas"}
    assert len(result["jobs"]) == 2
    assert len(result["schemas"]) == 1


def test_group_by_resource_type_empty_plan() -> None:
    assert _group_by_resource_type({}) == {}


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
    assert " 1 unchanged" in out
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
    plan = json.loads((fixtures_dir / "no-changes-plan.json").read_text())

    render_text(plan)

    out = capsys.readouterr().out
    assert "No changes" in out
    assert "8 resources unchanged" in out
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
    plan = json.loads((fixtures_dir / "mixed-plan.json").read_text())

    render_text(plan)

    out = capsys.readouterr().out
    assert "create" in out
    assert "delete" in out
    assert "update" in out


def test_render_text_sample_plan_fixture(fixtures_dir: Path, capsys: pytest.CaptureFixture[str]) -> None:
    plan = json.loads((fixtures_dir / "sample-plan.json").read_text())

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
    reachable = {action_to_diff_state(action) for action in _ACTIONS}
    assert reachable == set(DiffState) - {DiffState.UNKNOWN}


# --- _filter_resources ---


def test_filter_resources_by_state_keeps_matching() -> None:
    entries = {
        "resources.jobs.a": {"action": "create"},
        "resources.jobs.b": {"action": "skip"},
        "resources.jobs.c": {"action": "delete"},
    }

    result = _filter_resources(entries, visible_states=frozenset({DiffState.ADDED}))

    assert list(result.keys()) == ["resources.jobs.a"]


def test_filter_resources_by_state_multiple_states() -> None:
    entries = {
        "resources.jobs.a": {"action": "create"},
        "resources.jobs.b": {"action": "delete"},
        "resources.jobs.c": {"action": "skip"},
    }

    result = _filter_resources(entries, visible_states=frozenset({DiffState.ADDED, DiffState.REMOVED}))

    assert set(result.keys()) == {"resources.jobs.a", "resources.jobs.b"}


def test_filter_resources_by_state_returns_empty_when_none_match() -> None:
    entries = {"resources.jobs.a": {"action": "skip"}}

    result = _filter_resources(entries, visible_states=frozenset({DiffState.ADDED}))

    assert result == {}


def test_filter_resources_by_state_modified_includes_all_update_actions() -> None:
    entries = {
        "resources.jobs.a": {"action": "update"},
        "resources.jobs.b": {"action": "recreate"},
        "resources.jobs.c": {"action": "resize"},
        "resources.jobs.d": {"action": "update_id"},
        "resources.jobs.e": {"action": "skip"},
    }

    result = _filter_resources(entries, visible_states=frozenset({DiffState.MODIFIED}))

    assert len(result) == 4
    assert "resources.jobs.e" not in result


def test_filter_resources_by_predicate_keeps_matching() -> None:
    entries = {
        "resources.jobs.a": {"action": "create"},
        "resources.jobs.b": {"action": "skip"},
    }

    result = _filter_resources(entries, resource_filter=lambda k, _v: "jobs.a" in k)

    assert list(result.keys()) == ["resources.jobs.a"]


def test_filter_resources_both_filters_compose_as_and() -> None:
    entries = {
        "resources.jobs.a": {"action": "create"},
        "resources.jobs.b": {"action": "create"},
        "resources.jobs.c": {"action": "skip"},
    }

    result = _filter_resources(
        entries,
        visible_states=frozenset({DiffState.ADDED}),
        resource_filter=lambda k, _v: "jobs.b" in k,
    )

    assert list(result.keys()) == ["resources.jobs.b"]


# --- _format_group_header ---


def test_format_group_header_all_visible() -> None:
    assert _format_group_header("jobs", 3, 3) == "  jobs (3)"


def test_format_group_header_partial_visible() -> None:
    assert _format_group_header("experiments", 3, 1) == "  experiments (1/3)"


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
    plan = json.loads((fixtures_dir / "mixed-plan.json").read_text())
    all_changes = frozenset({DiffState.ADDED, DiffState.MODIFIED, DiffState.REMOVED})

    render_text(plan, visible_states=all_changes)

    out = capsys.readouterr().out
    # Changed resources visible
    assert "alerts/stale_pipeline_alert" in out
    assert "experiments/audit_analysis_final" in out
    assert "volumes/external_imports" in out
    # Unchanged groups hidden
    assert "jobs" not in out
    assert "schemas" not in out
    # Summary excludes unchanged when filtering
    assert "unchanged" not in out


def test_render_text_added_only_shows_creates(fixtures_dir: Path, capsys: pytest.CaptureFixture[str]) -> None:
    plan = json.loads((fixtures_dir / "mixed-plan.json").read_text())

    render_text(plan, visible_states=frozenset({DiffState.ADDED}))

    out = capsys.readouterr().out
    assert "experiments/audit_analysis_final" in out
    assert "(create)" in out
    # No modified or deleted
    assert "alerts/stale_pipeline_alert" not in out
    assert "volumes/external_imports" not in out


def test_render_text_removed_only_shows_deletes(fixtures_dir: Path, capsys: pytest.CaptureFixture[str]) -> None:
    plan = json.loads((fixtures_dir / "mixed-plan.json").read_text())

    render_text(plan, visible_states=frozenset({DiffState.REMOVED}))

    out = capsys.readouterr().out
    assert "volumes/external_imports" in out
    assert "(delete)" in out
    assert "experiments" not in out


def test_render_text_no_visible_states_shows_everything(fixtures_dir: Path, capsys: pytest.CaptureFixture[str]) -> None:
    plan = json.loads((fixtures_dir / "mixed-plan.json").read_text())

    render_text(plan)

    out = capsys.readouterr().out
    assert "jobs" in out
    assert "schemas" in out
    assert "alerts" in out


# --- _collect_warnings ---


def test_collect_warnings_detects_stateful_delete() -> None:
    resources = {"resources.volumes.imports": {"action": "delete"}}

    warnings = _collect_warnings(resources)

    assert len(warnings) == 1
    assert "volumes/imports" in warnings[0]
    assert "deleted" in warnings[0]
    assert "all files in this volume will be lost" in warnings[0]


def test_collect_warnings_detects_stateful_recreate() -> None:
    resources = {"resources.schemas.analytics": {"action": "recreate"}}

    warnings = _collect_warnings(resources)

    assert len(warnings) == 1
    assert "schemas/analytics" in warnings[0]
    assert "recreated" in warnings[0]
    assert "all tables, views, and volumes in this schema will be lost" in warnings[0]


def test_collect_warnings_ignores_non_stateful_delete() -> None:
    resources = {"resources.jobs.etl": {"action": "delete"}}

    assert _collect_warnings(resources) == []


def test_collect_warnings_ignores_stateful_update() -> None:
    resources = {"resources.schemas.analytics": {"action": "update"}}

    assert _collect_warnings(resources) == []


def test_collect_warnings_ignores_stateful_skip() -> None:
    resources = {"resources.volumes.data": {"action": "skip"}}

    assert _collect_warnings(resources) == []


@pytest.mark.parametrize(
    ("resource_type", "expected_risk"),
    [
        ("catalogs", "all schemas, tables, and volumes in this catalog"),
        ("schemas", "all tables, views, and volumes in this schema"),
        ("volumes", "all files in this volume"),
        ("registered_models", "all model versions"),
    ],
    ids=["catalogs", "schemas", "volumes", "registered_models"],
)
def test_collect_warnings_all_stateful_types(resource_type: str, expected_risk: str) -> None:
    resources = {f"resources.{resource_type}.x": {"action": "delete"}}

    warnings = _collect_warnings(resources)

    assert len(warnings) == 1
    assert expected_risk in warnings[0]


def test_collect_warnings_respects_visible_states_filter() -> None:
    resources = {
        "resources.volumes.imports": {"action": "delete"},
        "resources.schemas.analytics": {"action": "recreate"},
    }

    warnings = _collect_warnings(resources, visible_states=frozenset({DiffState.REMOVED}))

    assert len(warnings) == 1
    assert "volumes/imports" in warnings[0]


def test_collect_warnings_empty_when_filtered_out() -> None:
    resources = {"resources.volumes.imports": {"action": "delete"}}

    assert _collect_warnings(resources, visible_states=frozenset({DiffState.ADDED})) == []


def test_collect_warnings_multiple_sorted_by_key() -> None:
    resources = {
        "resources.volumes.z_data": {"action": "delete"},
        "resources.catalogs.a_main": {"action": "delete"},
    }

    warnings = _collect_warnings(resources)

    assert len(warnings) == 2
    assert "catalogs/a_main" in warnings[0]
    assert "volumes/z_data" in warnings[1]


def test_collect_warnings_covers_all_dangerous_actions() -> None:
    """Every action in _DANGEROUS_ACTIONS must trigger a warning on a stateful resource."""
    for action in _DANGEROUS_ACTIONS:
        resources = {"resources.schemas.test": {"action": action}}
        assert _collect_warnings(resources), f"action '{action}' should produce a warning"


def test_collect_warnings_covers_all_stateful_types() -> None:
    """Every type in _STATEFUL_RESOURCE_WARNINGS must trigger a warning on delete."""
    for resource_type in _STATEFUL_RESOURCE_WARNINGS:
        resources = {f"resources.{resource_type}.test": {"action": "delete"}}
        assert _collect_warnings(resources), f"resource type '{resource_type}' should produce a warning"


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
    plan = json.loads((fixtures_dir / "mixed-plan.json").read_text())

    render_text(plan)

    out = capsys.readouterr().out
    assert "\u26a0" in out
    assert "volumes/external_imports" in out
    assert "deleted" in out


def test_render_text_warning_appears_after_summary(fixtures_dir: Path, capsys: pytest.CaptureFixture[str]) -> None:
    plan = json.loads((fixtures_dir / "mixed-plan.json").read_text())

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
    plan = json.loads((fixtures_dir / "mixed-plan.json").read_text())

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
