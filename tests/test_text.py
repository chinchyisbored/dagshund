import sys
from pathlib import Path

import pytest

from dagshund import DagshundError
from dagshund.text import (
    _ACTIONS,
    _DEFAULT_ACTION,
    DIM,
    GREEN,
    RED,
    RESET,
    YELLOW,
    _action_config,
    _ActionConfig,
    _all_unchanged,
    _colorize,
    _count_by_action,
    _format_value,
    _group_by_resource_type,
    _parse_resource_key,
    _print_header,
    _print_resource_groups,
    _print_summary,
    _render_resource,
    _supports_color,
    render_text,
)

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
        "create", "delete", "update", "recreate", "resize",
        "update_id", "skip", "empty", "unknown",
    ],
)
def test_action_config(action: str, expected: _ActionConfig) -> None:
    assert _action_config(action) == expected


def test_actions_table_covers_all_update_actions() -> None:
    update_configs = [cfg for cfg in _ACTIONS.values() if cfg.show_field_changes]
    assert len(update_configs) == 4


# --- _parse_resource_key ---


@pytest.mark.parametrize(
    ("key", "expected"),
    [
        ("resources.jobs.etl_pipeline", ("jobs", "etl_pipeline")),
        ("resources.jobs.pipeline.extra", ("jobs", "pipeline.extra")),
        ("jobs.etl_pipeline", ("jobs", "etl_pipeline")),
        ("standalone", ("", "standalone")),
    ],
    ids=["three_parts", "dotted_name", "two_parts", "one_part"],
)
def test_parse_resource_key(key: str, expected: tuple[str, str]) -> None:
    assert _parse_resource_key(key) == expected


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


def test_format_value_truncates_long_string() -> None:
    result = _format_value("a" * 100)
    assert result.endswith('..."')
    assert len(result) < 100


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


def test_render_resource_empty_action_omits_label() -> None:
    lines = list(_render_resource("resources.jobs.stable", {"action": ""}, use_color=False))

    assert "  jobs/stable" in lines[0]
    assert "()" not in lines[0]
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


# --- _all_unchanged ---


def test_all_unchanged_all_skip() -> None:
    plan = {"a": {"action": "skip"}, "b": {"action": "skip"}}
    assert _all_unchanged(plan) is True


def test_all_unchanged_all_empty() -> None:
    plan = {"a": {"action": ""}, "b": {}}
    assert _all_unchanged(plan) is True


def test_all_unchanged_mixed_skip_and_empty() -> None:
    plan = {"a": {"action": "skip"}, "b": {"action": ""}}
    assert _all_unchanged(plan) is True


def test_all_unchanged_false_with_real_changes() -> None:
    plan = {"a": {"action": "skip"}, "b": {"action": "create"}}
    assert _all_unchanged(plan) is False


# --- render_text (integration) ---


def test_render_text_non_dict_plan_raises_error() -> None:
    with pytest.raises(DagshundError, match="plan must be an object"):
        render_text('{"plan": "not_a_dict"}')


def test_render_text_list_plan_raises_error() -> None:
    with pytest.raises(DagshundError, match="plan must be an object"):
        render_text('{"plan": [1, 2, 3]}')


def test_render_text_empty_plan_raises_error() -> None:
    with pytest.raises(DagshundError, match="plan is empty"):
        render_text('{"plan": {}}')


def test_render_text_missing_plan_key_raises_error() -> None:
    with pytest.raises(DagshundError, match="plan is empty"):
        render_text('{"cli_version": "1.0"}')


def test_render_text_all_unchanged_shows_no_changes(
    fixtures_dir: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    plan_json = (fixtures_dir / "no-changes-plan.json").read_text()

    render_text(plan_json)

    out = capsys.readouterr().out
    assert "No changes" in out
    assert "8 resources unchanged" in out
    # Should NOT list individual resources
    assert "alerts" not in out
    assert "(skip)" not in out
    assert "(unchanged)" not in out


def test_render_text_real_fixture(real_plan_json: str, capsys: pytest.CaptureFixture[str]) -> None:
    render_text(real_plan_json)

    out = capsys.readouterr().out
    assert "etl_pipeline" in out
    assert "create" in out
    assert "update" in out
    assert "delete" in out
    assert "jobs" in out
    assert "alerts" in out
