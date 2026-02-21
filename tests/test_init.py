"""Tests for dagshund package-level exports."""

import pytest

from dagshund import DagshundError, parse_plan

# --- parse_plan ---


def test_parse_plan_valid_json_object() -> None:
    assert parse_plan('{"plan": {}}') == {"plan": {}}


def test_parse_plan_invalid_json_raises() -> None:
    with pytest.raises(DagshundError, match="invalid JSON"):
        parse_plan("not valid json")


def test_parse_plan_array_raises() -> None:
    with pytest.raises(DagshundError, match="must be an object"):
        parse_plan("[1, 2, 3]")


def test_parse_plan_string_raises() -> None:
    with pytest.raises(DagshundError, match="must be an object"):
        parse_plan('"just a string"')
