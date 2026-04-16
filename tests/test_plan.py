"""Tests for plan parsing, change detection, and drift predicates."""

import pytest
from factories import make_change, make_resource, resources_from_dict

from dagshund.model import parse_plan
from dagshund.plan import (
    DANGEROUS_ACTIONS,
    STATEFUL_RESOURCE_TYPES,
    detect_changes,
    detect_dangerous_actions,
    detect_manual_edits,
    has_drifted_field,
    is_topology_drift_change,
)
from dagshund.types import DagshundError

# --- parse_plan ---


def test_parse_plan_valid_json_object() -> None:
    plan = parse_plan('{"plan": {}}')
    assert plan.resources == {}


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
    resources = {"a": make_resource(action="skip"), "b": make_resource(action="skip")}
    assert detect_changes(resources) is False


def test_detect_changes_empty_action_returns_false() -> None:
    assert detect_changes({"a": make_resource(action="")}) is False


def test_detect_changes_unknown_action_returns_true() -> None:
    """Resources with an unknown action are treated as changed (conservative)."""
    assert detect_changes({"a": make_resource(action="unknown")}) is True


def test_detect_changes_with_create_returns_true() -> None:
    resources = {"a": make_resource(action="skip"), "b": make_resource(action="create")}
    assert detect_changes(resources) is True


def test_detect_changes_empty_dict_returns_false() -> None:
    assert detect_changes({}) is False


# --- has_drifted_field ---


def test_has_drifted_field_old_equals_new_remote_differs_returns_true() -> None:
    assert has_drifted_field(make_change(action="update", old="A", new="A", remote="B")) is True


def test_has_drifted_field_old_equals_new_remote_absent_returns_false() -> None:
    assert has_drifted_field(make_change(action="update", old="A", new="A")) is False


def test_has_drifted_field_old_equals_new_remote_equals_old_returns_false() -> None:
    assert has_drifted_field(make_change(action="update", old="A", new="A", remote="A")) is False


def test_has_drifted_field_old_differs_from_new_returns_false() -> None:
    assert has_drifted_field(make_change(action="update", old="A", new="B", remote="C")) is False


def test_has_drifted_field_skip_action_returns_false() -> None:
    assert has_drifted_field(make_change(action="skip", old="A", new="A", remote="B")) is False


def test_has_drifted_field_empty_action_returns_false() -> None:
    assert has_drifted_field(make_change(action="", old="A", new="A", remote="B")) is False


def test_has_drifted_field_missing_old_returns_false() -> None:
    assert has_drifted_field(make_change(action="update", new="A", remote="B")) is False


def test_has_drifted_field_missing_new_returns_false() -> None:
    assert has_drifted_field(make_change(action="update", old="A", remote="B")) is False


# --- is_topology_drift_change ---


def test_is_topology_drift_change_update_old_equals_new_no_remote_returns_true() -> None:
    assert is_topology_drift_change(make_change(action="update", old="A", new="A")) is True


def test_is_topology_drift_change_field_drift_returns_false() -> None:
    """Field drift (remote present and differs) is the domain of has_drifted_field."""
    assert is_topology_drift_change(make_change(action="update", old="A", new="A", remote="B")) is False


def test_is_topology_drift_change_remote_equals_old_returns_false() -> None:
    assert is_topology_drift_change(make_change(action="update", old="A", new="A", remote="A")) is False


def test_is_topology_drift_change_old_differs_from_new_returns_false() -> None:
    assert is_topology_drift_change(make_change(action="update", old="A", new="B")) is False


def test_is_topology_drift_change_missing_old_returns_false() -> None:
    assert is_topology_drift_change(make_change(action="update", new="A")) is False


def test_is_topology_drift_change_missing_new_returns_false() -> None:
    assert is_topology_drift_change(make_change(action="update", old="A")) is False


def test_is_topology_drift_change_skip_action_returns_false() -> None:
    assert is_topology_drift_change(make_change(action="skip", old="A", new="A")) is False


def test_is_topology_drift_change_empty_action_returns_false() -> None:
    assert is_topology_drift_change(make_change(action="", old="A", new="A")) is False


def test_is_topology_drift_change_recreate_action_returns_false() -> None:
    """Narrow gate: only action=update counts. recreate with this shape is not topology drift."""
    assert is_topology_drift_change(make_change(action="recreate", old="A", new="A")) is False


def test_is_topology_drift_change_resize_action_returns_false() -> None:
    assert is_topology_drift_change(make_change(action="resize", old="A", new="A")) is False


def test_is_topology_drift_change_deep_equal_nested_dicts_returns_true() -> None:
    change = make_change(
        action="update",
        old={"task_key": "transform", "notebook_task": {"notebook_path": "/x"}},
        new={"task_key": "transform", "notebook_task": {"notebook_path": "/x"}},
    )
    assert is_topology_drift_change(change) is True


def test_is_topology_drift_change_deep_equal_lists_returns_true() -> None:
    change = make_change(
        action="update",
        old=[{"task_key": "a"}, {"task_key": "b"}],
        new=[{"task_key": "a"}, {"task_key": "b"}],
    )
    assert is_topology_drift_change(change) is True


# --- detect_manual_edits ---


def test_detect_manual_edits_with_drifted_field_returns_true() -> None:
    resources = {
        "resources.jobs.my_job": make_resource(
            action="update",
            changes={
                "edit_mode": make_change(action="update", old="LOCKED", new="LOCKED", remote="EDITABLE"),
            },
        )
    }
    assert detect_manual_edits(resources) is True


def test_detect_manual_edits_no_drift_returns_false() -> None:
    resources = {
        "resources.jobs.my_job": make_resource(
            action="update",
            changes={
                "name": make_change(action="update", old="A", new="B"),
            },
        )
    }
    assert detect_manual_edits(resources) is False


def test_detect_manual_edits_empty_changes_returns_false() -> None:
    resources = {"resources.jobs.my_job": make_resource(action="update")}
    assert detect_manual_edits(resources) is False


def test_detect_manual_edits_no_changes_dict_returns_false() -> None:
    """Non-dict changes at the raw parse boundary are discarded, leaving empty changes."""
    resources = resources_from_dict({"resources.jobs.my_job": {"action": "update", "changes": "not a dict"}})
    assert detect_manual_edits(resources) is False


def test_detect_manual_edits_non_dict_field_change_discarded() -> None:
    """Non-dict field change values are dropped by the parser."""
    resources = resources_from_dict(
        {"resources.jobs.my_job": {"action": "update", "changes": {"weird_field": "just a string"}}}
    )
    # The "weird_field" value parses to a default (empty) FieldChange with no drift markers.
    assert detect_manual_edits(resources) is False


def test_detect_manual_edits_empty_resources_returns_false() -> None:
    assert detect_manual_edits({}) is False


# --- detect_dangerous_actions ---


def test_detect_dangerous_actions_non_stateful_type_returns_false() -> None:
    resources = {"resources.jobs.etl_pipeline": make_resource(action="delete")}
    assert detect_dangerous_actions(resources) is False


@pytest.mark.parametrize("action", ["update", "create", "skip"])
def test_detect_dangerous_actions_safe_action_on_stateful_returns_false(action: str) -> None:
    resources = {"resources.schemas.analytics": make_resource(action=action)}
    assert detect_dangerous_actions(resources) is False


def test_detect_dangerous_actions_empty_resources_returns_false() -> None:
    assert detect_dangerous_actions({}) is False


def test_detect_dangerous_actions_missing_action_returns_false() -> None:
    resources = {"resources.volumes.data": make_resource()}
    assert detect_dangerous_actions(resources) is False


def test_detect_dangerous_actions_mixed_safe_and_dangerous_returns_true() -> None:
    resources = {
        "resources.jobs.etl_pipeline": make_resource(action="update"),
        "resources.schemas.analytics": make_resource(action="delete"),
    }
    assert detect_dangerous_actions(resources) is True


def test_detect_dangerous_actions_sub_resource_key_returns_true() -> None:
    resources = {"resources.schemas.analytics.permissions": make_resource(action="delete")}
    assert detect_dangerous_actions(resources) is True


@pytest.mark.parametrize("action", sorted(a.value for a in DANGEROUS_ACTIONS))
def test_detect_dangerous_actions_all_dangerous_actions(action: str) -> None:
    """Every action in DANGEROUS_ACTIONS triggers on a stateful resource."""
    resources = {"resources.schemas.test": make_resource(action=action)}
    assert detect_dangerous_actions(resources) is True


@pytest.mark.parametrize("resource_type", sorted(STATEFUL_RESOURCE_TYPES))
def test_detect_dangerous_actions_all_stateful_types(resource_type: str) -> None:
    """Every type in STATEFUL_RESOURCE_TYPES triggers on delete."""
    resources = {f"resources.{resource_type}.test": make_resource(action="delete")}
    assert detect_dangerous_actions(resources) is True
