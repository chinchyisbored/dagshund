"""Tests for plan parsing, change detection, and drift predicates."""

import pytest

from dagshund import (
    DagshundError,
    detect_changes,
    detect_dangerous_actions,
    detect_manual_edits,
    has_drifted_field,
    parse_plan,
)
from dagshund.plan import DANGEROUS_ACTIONS, STATEFUL_RESOURCE_TYPES

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
    deeply_nested = '{"a":' * 100000 + "{}" + "}" * 100000
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


def test_detect_changes_empty_action_returns_false() -> None:
    assert detect_changes({"a": {"action": ""}}) is False


def test_detect_changes_missing_action_returns_true() -> None:
    assert detect_changes({"a": {}}) is True


def test_detect_changes_with_create_returns_true() -> None:
    assert detect_changes({"a": {"action": "skip"}, "b": {"action": "create"}}) is True


def test_detect_changes_empty_dict_returns_false() -> None:
    assert detect_changes({}) is False


# --- has_drifted_field ---


def test_has_drifted_field_old_equals_new_remote_differs_returns_true() -> None:
    assert has_drifted_field({"action": "update", "old": "A", "new": "A", "remote": "B"}) is True


def test_has_drifted_field_old_equals_new_remote_absent_returns_false() -> None:
    assert has_drifted_field({"action": "update", "old": "A", "new": "A"}) is False


def test_has_drifted_field_old_equals_new_remote_equals_old_returns_false() -> None:
    assert has_drifted_field({"action": "update", "old": "A", "new": "A", "remote": "A"}) is False


def test_has_drifted_field_old_differs_from_new_returns_false() -> None:
    assert has_drifted_field({"action": "update", "old": "A", "new": "B", "remote": "C"}) is False


def test_has_drifted_field_skip_action_returns_false() -> None:
    assert has_drifted_field({"action": "skip", "old": "A", "new": "A", "remote": "B"}) is False


def test_has_drifted_field_empty_action_returns_false() -> None:
    assert has_drifted_field({"action": "", "old": "A", "new": "A", "remote": "B"}) is False


def test_has_drifted_field_missing_old_returns_false() -> None:
    assert has_drifted_field({"action": "update", "new": "A", "remote": "B"}) is False


def test_has_drifted_field_missing_new_returns_false() -> None:
    assert has_drifted_field({"action": "update", "old": "A", "remote": "B"}) is False


# --- detect_manual_edits ---


def test_detect_manual_edits_with_drifted_field_returns_true() -> None:
    resources = {
        "resources.jobs.my_job": {
            "action": "update",
            "changes": {
                "edit_mode": {"action": "update", "old": "LOCKED", "new": "LOCKED", "remote": "EDITABLE"},
            },
        }
    }
    assert detect_manual_edits(resources) is True


def test_detect_manual_edits_no_drift_returns_false() -> None:
    resources = {
        "resources.jobs.my_job": {
            "action": "update",
            "changes": {
                "name": {"action": "update", "old": "A", "new": "B"},
            },
        }
    }
    assert detect_manual_edits(resources) is False


def test_detect_manual_edits_empty_changes_returns_false() -> None:
    resources = {"resources.jobs.my_job": {"action": "update", "changes": {}}}
    assert detect_manual_edits(resources) is False


def test_detect_manual_edits_no_changes_key_returns_false() -> None:
    resources = {"resources.jobs.my_job": {"action": "update"}}
    assert detect_manual_edits(resources) is False


def test_detect_manual_edits_non_dict_changes_returns_false() -> None:
    resources = {"resources.jobs.my_job": {"action": "update", "changes": "not a dict"}}
    assert detect_manual_edits(resources) is False


def test_detect_manual_edits_non_dict_field_change_skipped() -> None:
    resources = {
        "resources.jobs.my_job": {
            "action": "update",
            "changes": {"weird_field": "just a string"},
        }
    }
    assert detect_manual_edits(resources) is False


def test_detect_manual_edits_empty_resources_returns_false() -> None:
    assert detect_manual_edits({}) is False


# --- detect_dangerous_actions ---


def test_detect_dangerous_actions_non_stateful_type_returns_false() -> None:
    resources = {"resources.jobs.etl_pipeline": {"action": "delete"}}
    assert detect_dangerous_actions(resources) is False


@pytest.mark.parametrize("action", ["update", "create", "skip"])
def test_detect_dangerous_actions_safe_action_on_stateful_returns_false(action: str) -> None:
    resources = {"resources.schemas.analytics": {"action": action}}
    assert detect_dangerous_actions(resources) is False


def test_detect_dangerous_actions_empty_resources_returns_false() -> None:
    assert detect_dangerous_actions({}) is False


def test_detect_dangerous_actions_missing_action_key_returns_false() -> None:
    resources = {"resources.volumes.data": {}}
    assert detect_dangerous_actions(resources) is False


def test_detect_dangerous_actions_mixed_safe_and_dangerous_returns_true() -> None:
    resources = {
        "resources.jobs.etl_pipeline": {"action": "update"},
        "resources.schemas.analytics": {"action": "delete"},
    }
    assert detect_dangerous_actions(resources) is True


def test_detect_dangerous_actions_sub_resource_key_returns_true() -> None:
    resources = {"resources.schemas.analytics.permissions": {"action": "delete"}}
    assert detect_dangerous_actions(resources) is True


@pytest.mark.parametrize("action", sorted(DANGEROUS_ACTIONS))
def test_detect_dangerous_actions_all_dangerous_actions(action: str) -> None:
    """Every action in DANGEROUS_ACTIONS triggers on a stateful resource."""
    resources = {"resources.schemas.test": {"action": action}}
    assert detect_dangerous_actions(resources) is True


@pytest.mark.parametrize("resource_type", sorted(STATEFUL_RESOURCE_TYPES))
def test_detect_dangerous_actions_all_stateful_types(resource_type: str) -> None:
    """Every type in STATEFUL_RESOURCE_TYPES triggers on delete."""
    resources = {f"resources.{resource_type}.test": {"action": "delete"}}
    assert detect_dangerous_actions(resources) is True
