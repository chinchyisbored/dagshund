"""Tests for dagshund package-level exports."""

import pytest

from dagshund import DagshundError, detect_changes, parse_plan

# --- parse_plan ---


def test_parse_plan_valid_json_object() -> None:
    assert parse_plan('{"plan": {}}') == {"plan": {}}


def test_parse_plan_invalid_json_raises() -> None:
    with pytest.raises(DagshundError, match="invalid JSON"):
        parse_plan("not valid json")


def test_parse_plan_empty_string_raises() -> None:
    with pytest.raises(DagshundError, match="invalid JSON"):
        parse_plan("")


def test_parse_plan_deeply_nested_json_raises() -> None:
    deeply_nested = '{"a":' * 100000 + '{}' + '}' * 100000
    with pytest.raises(DagshundError, match="too deeply nested"):
        parse_plan(deeply_nested)


@pytest.mark.parametrize(
    ("raw", "match"),
    [
        ("[1, 2, 3]", "must be an object"),
        ('"just a string"', "must be an object"),
        ("42", "must be an object"),
        ("true", "must be an object"),
        ("null", "must be an object"),
    ],
    ids=["array", "string", "number", "boolean", "null"],
)
def test_parse_plan_non_object_raises(raw: str, match: str) -> None:
    with pytest.raises(DagshundError, match=match):
        parse_plan(raw)


# --- detect_changes ---


def test_detect_changes_all_skip_returns_false() -> None:
    assert detect_changes({"a": {"action": "skip"}, "b": {"action": "skip"}}) is False


def test_detect_changes_empty_action_returns_true() -> None:
    assert detect_changes({"a": {"action": ""}}) is True


def test_detect_changes_missing_action_returns_true() -> None:
    assert detect_changes({"a": {}}) is True


def test_detect_changes_with_create_returns_true() -> None:
    assert detect_changes({"a": {"action": "skip"}, "b": {"action": "create"}}) is True


def test_detect_changes_empty_dict_returns_false() -> None:
    assert detect_changes({}) is False
