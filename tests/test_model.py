"""Tests for model.py — parser boundary coverage."""

import json
from pathlib import Path

import pytest

from dagshund.model import (
    UNSET,
    ActionType,
    FieldChange,
    UnsetSentinel,
    parse_action,
    parse_field_change,
    parse_plan,
    parse_plan_data,
    parse_resource_change,
)

GOLDEN_DIR = Path(__file__).parent.parent / "fixtures" / "golden"
GOLDEN_PLANS = sorted(p for p in GOLDEN_DIR.iterdir() if p.is_dir() and (p / "plan.json").exists())


# --- golden round-trip ---


@pytest.mark.parametrize(
    "fixture_dir",
    GOLDEN_PLANS,
    ids=[p.name for p in GOLDEN_PLANS],
)
def test_parse_plan_golden_round_trip(fixture_dir: Path) -> None:
    raw = (fixture_dir / "plan.json").read_text()
    plan = parse_plan(raw)

    expected = json.loads(raw)
    assert dict(plan.raw) == expected


# --- parse_action ---


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("create", ActionType.CREATE),
        ("delete", ActionType.DELETE),
        ("update", ActionType.UPDATE),
        ("recreate", ActionType.RECREATE),
        ("resize", ActionType.RESIZE),
        ("update_id", ActionType.UPDATE_ID),
        ("skip", ActionType.SKIP),
        ("", ActionType.EMPTY),
    ],
    ids=["create", "delete", "update", "recreate", "resize", "update_id", "skip", "empty"],
)
def test_parse_action_known_values(value: str, expected: ActionType) -> None:
    assert parse_action(value) is expected


@pytest.mark.parametrize(
    "value",
    ["nope", "CREATE", "Delete", "  create", 42, None, True, 3.14, [], {}],
    ids=["unknown_str", "uppercase", "mixed_case", "leading_space", "int", "none", "bool", "float", "list", "dict"],
)
def test_parse_action_unknown_returns_unknown(value: object) -> None:
    assert parse_action(value) is ActionType.UNKNOWN


# --- parse_field_change ---


def test_parse_field_change_full_dict() -> None:
    raw = {"action": "update", "reason": "changed", "old": 1, "new": 2, "remote": 3}

    result = parse_field_change(raw)

    assert result.action is ActionType.UPDATE
    assert result.reason == "changed"
    assert result.old == 1
    assert result.new == 2
    assert result.remote == 3


def test_parse_field_change_absent_keys_are_unset() -> None:
    result = parse_field_change({})

    assert result.old is UNSET
    assert result.new is UNSET
    assert result.remote is UNSET


def test_parse_field_change_null_values_are_none() -> None:
    raw = {"old": None, "new": None, "remote": None}

    result = parse_field_change(raw)

    assert result.old is None
    assert result.new is None
    assert result.remote is None


def test_parse_field_change_unset_vs_none_distinction() -> None:
    present_null = parse_field_change({"old": None})
    absent = parse_field_change({})

    assert present_null.old is None
    assert absent.old is UNSET
    assert present_null.old is not absent.old


def test_parse_field_change_non_dict_returns_default() -> None:
    result = parse_field_change("not a dict")

    assert result == FieldChange()
    assert result.action is ActionType.EMPTY
    assert result.old is UNSET


@pytest.mark.parametrize(
    "value",
    [42, None, [], True],
    ids=["int", "none", "list", "bool"],
)
def test_parse_field_change_non_dict_types_return_default(value: object) -> None:
    assert parse_field_change(value) == FieldChange()


def test_parse_field_change_non_string_reason_is_none() -> None:
    result = parse_field_change({"reason": 42})

    assert result.reason is None


def test_parse_field_change_complex_payload_values() -> None:
    raw = {"old": {"nested": [1, 2]}, "new": [3, 4, 5]}

    result = parse_field_change(raw)

    assert result.old == {"nested": [1, 2]}
    assert result.new == [3, 4, 5]


# --- parse_resource_change ---


def test_parse_resource_change_full_entry() -> None:
    raw = {
        "action": "create",
        "changes": {"name": {"action": "create", "new": "foo"}},
        "new_state": {"value": {"name": "foo"}},
        "depends_on": [{"node": "resources.jobs.other"}],
    }

    result = parse_resource_change("resources.jobs.my_job", raw)

    assert result.key == "resources.jobs.my_job"
    assert result.action is ActionType.CREATE
    assert "name" in result.changes
    assert result.changes["name"].new == "foo"
    assert result.new_state == {"value": {"name": "foo"}}
    assert result.depends_on == (("resources.jobs.other", None),)


def test_parse_resource_change_non_dict_returns_default() -> None:
    result = parse_resource_change("resources.jobs.x", "garbage")

    assert result.key == "resources.jobs.x"
    assert result.action is ActionType.EMPTY
    assert result.changes == {}
    assert result.depends_on == ()


def test_parse_resource_change_non_dict_changes_ignored() -> None:
    result = parse_resource_change("k", {"changes": "not a dict"})

    assert result.changes == {}


def test_parse_resource_change_non_string_change_keys_skipped() -> None:
    result = parse_resource_change("k", {"changes": {42: {"action": "create"}}})

    assert result.changes == {}


def test_parse_resource_change_states_preserved() -> None:
    raw = {"new_state": {"x": 1}, "remote_state": {"y": 2}}

    result = parse_resource_change("k", raw)

    assert result.new_state == {"x": 1}
    assert result.remote_state == {"y": 2}


def test_parse_resource_change_missing_states_are_none() -> None:
    result = parse_resource_change("k", {})

    assert result.new_state is None
    assert result.remote_state is None


# --- _parse_depends_on (via parse_resource_change) ---


def test_depends_on_with_labels() -> None:
    raw = {
        "depends_on": [
            {"node": "a", "label": "upstream"},
            {"node": "b", "label": "sidecar"},
        ]
    }

    result = parse_resource_change("k", raw)

    assert result.depends_on == (("a", "upstream"), ("b", "sidecar"))


def test_depends_on_without_labels() -> None:
    raw = {"depends_on": [{"node": "a"}, {"node": "b"}]}

    result = parse_resource_change("k", raw)

    assert result.depends_on == (("a", None), ("b", None))


def test_depends_on_non_list_ignored() -> None:
    result = parse_resource_change("k", {"depends_on": "not a list"})

    assert result.depends_on == ()


def test_depends_on_non_dict_items_skipped() -> None:
    raw = {"depends_on": ["just a string", 42, {"node": "valid"}]}

    result = parse_resource_change("k", raw)

    assert result.depends_on == (("valid", None),)


def test_depends_on_missing_node_skipped() -> None:
    raw = {"depends_on": [{"label": "orphan"}, {"node": "ok"}]}

    result = parse_resource_change("k", raw)

    assert result.depends_on == (("ok", None),)


def test_depends_on_non_string_node_skipped() -> None:
    raw = {"depends_on": [{"node": 42}, {"node": "ok"}]}

    result = parse_resource_change("k", raw)

    assert result.depends_on == (("ok", None),)


def test_depends_on_non_string_label_becomes_none() -> None:
    raw = {"depends_on": [{"node": "a", "label": 99}]}

    result = parse_resource_change("k", raw)

    assert result.depends_on == (("a", None),)


# --- parse_plan_data ---


def test_parse_plan_data_extracts_metadata() -> None:
    raw = {
        "plan": {},
        "plan_version": 3,
        "cli_version": "0.242.0",
        "lineage": "abc-123",
        "serial": 7,
    }

    result = parse_plan_data(raw)

    assert result.plan_version == 3
    assert result.cli_version == "0.242.0"
    assert result.lineage == "abc-123"
    assert result.serial == 7


def test_parse_plan_data_missing_metadata_is_none() -> None:
    result = parse_plan_data({"plan": {}})

    assert result.plan_version is None
    assert result.cli_version is None
    assert result.lineage is None
    assert result.serial is None


def test_parse_plan_data_bool_plan_version_rejected() -> None:
    result = parse_plan_data({"plan": {}, "plan_version": True})

    assert result.plan_version is None


def test_parse_plan_data_string_serial_rejected() -> None:
    result = parse_plan_data({"plan": {}, "serial": "7"})

    assert result.serial is None


def test_parse_plan_data_missing_plan_key_gives_empty_resources() -> None:
    result = parse_plan_data({})

    assert result.resources == {}


def test_parse_plan_data_non_dict_plan_value_gives_empty_resources() -> None:
    result = parse_plan_data({"plan": "not a dict"})

    assert result.resources == {}


def test_parse_plan_data_preserves_raw() -> None:
    raw = {"plan": {}, "extra_key": "preserved"}

    result = parse_plan_data(raw)

    assert result.raw is raw
    assert result.raw["extra_key"] == "preserved"


# --- UnsetSentinel identity ---


def test_unset_is_singleton() -> None:
    assert UNSET is UnsetSentinel.UNSET


def test_unset_is_not_none() -> None:
    assert UNSET is not None
    assert UNSET != None  # noqa: E711


def test_unset_repr() -> None:
    assert "UNSET" in repr(UNSET)
