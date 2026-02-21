import sys
from dataclasses import dataclass

import pytest

from dagshund import DagshundError
from dagshund.text import (
    DIM,
    GREEN,
    RED,
    RESET,
    UPDATE_ACTIONS,
    YELLOW,
    _action_color,
    _action_symbol,
    _colorize,
    _count_by_action,
    _format_value,
    _group_by_resource_type,
    _parse_plan,
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


# --- _action_color / _action_symbol ---


@dataclass(frozen=True)
class ActionMappingCase:
    name: str
    action: str
    expected_color: str
    expected_symbol: str


ACTION_MAPPING_CASES: list[ActionMappingCase] = [
    ActionMappingCase("create", "create", GREEN, "+"),
    ActionMappingCase("delete", "delete", RED, "-"),
    ActionMappingCase("skip", "skip", DIM, " "),
    ActionMappingCase("empty", "", DIM, " "),
    ActionMappingCase("unknown", "unknown_action", RESET, "?"),
    *[ActionMappingCase(action, action, YELLOW, "~") for action in sorted(UPDATE_ACTIONS)],
]


@pytest.mark.parametrize("case", ACTION_MAPPING_CASES, ids=lambda c: c.name)
def test_action_color(case: ActionMappingCase) -> None:
    assert _action_color(case.action) == case.expected_color


@pytest.mark.parametrize("case", ACTION_MAPPING_CASES, ids=lambda c: c.name)
def test_action_symbol(case: ActionMappingCase) -> None:
    assert _action_symbol(case.action) == case.expected_symbol


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
    lines = _render_resource("resources.jobs.etl", {"action": "create"}, use_color=False)

    assert len(lines) == 1
    assert "+ jobs/etl" in lines[0]
    assert "(create)" in lines[0]


def test_render_resource_delete_action() -> None:
    lines = _render_resource("resources.jobs.old", {"action": "delete"}, use_color=False)

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

    lines = _render_resource("resources.jobs.pipeline", entry, use_color=False)

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

    lines = _render_resource("resources.jobs.pipeline", entry, use_color=False)

    assert len(lines) == 2
    assert '"value"' in lines[1]


def test_render_resource_field_change_old_only() -> None:
    entry = {
        "action": "update",
        "changes": {"removed_field": {"action": "delete", "old": "gone"}},
    }

    lines = _render_resource("resources.jobs.pipeline", entry, use_color=False)

    assert len(lines) == 2
    assert '"gone"' in lines[1]


def test_render_resource_empty_action_omits_label() -> None:
    lines = _render_resource("resources.jobs.stable", {"action": ""}, use_color=False)

    assert "  jobs/stable" in lines[0]
    assert "()" not in lines[0]


def test_render_resource_with_color_includes_ansi() -> None:
    lines = _render_resource("resources.jobs.etl", {"action": "create"}, use_color=True)

    assert GREEN in lines[0]
    assert RESET in lines[0]


# --- _count_by_action ---


def test_count_by_action_mixed() -> None:
    entries = {
        "a": {"action": "create"},
        "b": {"action": "create"},
        "c": {"action": "delete"},
        "d": {"action": "update"},
    }

    assert _count_by_action(entries) == {"create": 2, "delete": 1, "update": 1}


def test_count_by_action_empty_becomes_unchanged() -> None:
    entries = {"a": {"action": ""}, "b": {}}
    assert _count_by_action(entries) == {"unchanged": 2}


# --- _parse_plan ---


def test_parse_plan_valid_json() -> None:
    assert _parse_plan('{"plan": {}}') == {"plan": {}}


def test_parse_plan_invalid_json_raises() -> None:
    with pytest.raises(DagshundError, match="invalid JSON"):
        _parse_plan("not json")


def test_parse_plan_non_dict_raises() -> None:
    with pytest.raises(DagshundError, match="must be an object"):
        _parse_plan("[1]")


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
    by_type = {"jobs": [("resources.jobs.etl", {"action": "create"})]}

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


# --- render_text (integration) ---


def test_render_text_empty_plan_prints_warning(capsys: pytest.CaptureFixture[str]) -> None:
    render_text('{"plan": {}}')
    assert "plan is empty" in capsys.readouterr().err


def test_render_text_missing_plan_key_prints_warning(capsys: pytest.CaptureFixture[str]) -> None:
    render_text('{"cli_version": "1.0"}')
    assert "plan is empty" in capsys.readouterr().err


def test_render_text_real_fixture(real_plan_json: str, capsys: pytest.CaptureFixture[str]) -> None:
    render_text(real_plan_json)

    out = capsys.readouterr().out
    assert "etl_pipeline" in out
    assert "create" in out
    assert "update" in out
    assert "delete" in out
    assert "jobs" in out
    assert "alerts" in out
