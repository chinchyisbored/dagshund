"""Tests for plan parsing, change detection, and drift predicates."""

import json
from dataclasses import dataclass, replace
from pathlib import Path

import pytest
from factories import make_change, make_resource, resources_from_dict

from dagshund.merge import normalize_plan
from dagshund.model import FieldChange, parse_plan, parse_resource_change
from dagshund.plan import (
    DANGEROUS_ACTIONS,
    STATEFUL_RESOURCE_TYPES,
    ResourceDrift,
    classify_pipeline_cascade_risk,
    classify_resource_drift,
    detect_changes,
    detect_dangerous_actions,
    detect_manual_edits,
    has_drifted_field,
    is_state_cleanup,
    is_topology_drift_change,
)
from dagshund.types import DagshundError


def test_unknown_secret_comparison_does_not_claim_drift() -> None:
    plan = parse_plan(
        '{"plan":{"resources.secrets.token":{"action":"update","changes":{"value":'
        '{"action":"update","old":"[REDACTED]","new":"new-secret","remote":"remote-secret"}}}}}'
    )

    assert not detect_manual_edits(normalize_plan(plan.resources))


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


@pytest.mark.parametrize(
    ("action", "flags", "expected_cleanup"),
    [
        ("delete", {"gone": True}, True),
        ("delete", {"state_only": True}, True),
        ("delete", {"gone": True, "state_only": True}, True),
        ("delete", {}, False),
        ("delete", {"gone": False, "state_only": None}, False),
        ("delete", {"gone": "true", "state_only": 1}, False),
        ("update", {"gone": True}, False),
    ],
)
def test_cleanup_flags_are_literal_true_and_require_delete(
    action: str, flags: dict[str, object], expected_cleanup: bool
) -> None:
    from dagshund.plan import action_to_diff_state, entry_to_diff_state

    entry = replace(make_resource(action=action), **flags)

    assert is_state_cleanup(entry) is expected_cleanup
    expected_state = "modified" if expected_cleanup else action_to_diff_state(entry.action).value
    assert entry_to_diff_state(entry).value == expected_state


def test_shared_cleanup_vectors_preserve_raw_flags_and_classify_literal_true() -> None:
    vectors = json.loads((Path(__file__).parents[1] / "fixtures/state-cleanup-cases.json").read_text())

    for vector in vectors:
        raw = {key: value for key, value in vector.items() if key not in ("name", "cleanup")}
        original = raw.copy()
        entry = parse_resource_change("resources.test.cleanup", raw)

        assert is_state_cleanup(entry) is vector["cleanup"], vector["name"]
        assert entry.action.value == vector["action"]
        assert raw == original
        for flag in ("gone", "state_only"):
            if flag in raw:
                assert getattr(entry, flag) == raw[flag]


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


# --- classify_resource_drift ---


@dataclass(frozen=True, slots=True)
class ResourceDriftCase:
    name: str
    changes: dict[str, FieldChange]
    expected: ResourceDrift


@pytest.mark.parametrize(
    "case",
    [
        ResourceDriftCase("empty", {}, ResourceDrift((), (), False)),
        ResourceDriftCase(
            "ordinary",
            {"field": make_change(action="update", old="a", new="b", remote="c")},
            ResourceDrift((), (), False),
        ),
        ResourceDriftCase(
            "equal-remote",
            {"field": make_change(action="update", old="a", new="a", remote="a")},
            ResourceDrift((), (), False),
        ),
        ResourceDriftCase(
            "missing-old", {"field": make_change(action="update", new="a", remote="b")}, ResourceDrift((), (), False)
        ),
        ResourceDriftCase(
            "missing-new", {"field": make_change(action="update", old="a", remote="b")}, ResourceDrift((), (), False)
        ),
        ResourceDriftCase(
            "skip", {"field": make_change(action="skip", old="a", new="a", remote="b")}, ResourceDrift((), (), False)
        ),
        ResourceDriftCase(
            "empty-action", {"field": make_change(old="a", new="a", remote="b")}, ResourceDrift((), (), False)
        ),
        ResourceDriftCase(
            "topology-only",
            {"task": make_change(action="update", old={"task_key": "x"}, new={"task_key": "x"})},
            ResourceDrift((), ("task",), False),
        ),
        ResourceDriftCase(
            "sorted-mixed",
            {
                "z_field": make_change(action="update", old=1, new=1, remote=2),
                "a_field": make_change(action="update", old="x", new="x", remote="y"),
                "tasks[task_key='zulu']": make_change(action="update", old={"x": 1}, new={"x": 1}),
                "tasks[task_key='alpha']": make_change(action="update", old={"y": 2}, new={"y": 2}),
                "noise": make_change(action="skip", old=1, new=1),
            },
            ResourceDrift(("a_field", "z_field"), ("tasks[task_key='alpha']", "tasks[task_key='zulu']"), True),
        ),
    ],
    ids=lambda c: c.name,
)
def test_classify_resource_drift_partitions_changes(case: ResourceDriftCase) -> None:
    entry = make_resource(action="update", changes=case.changes)

    result = classify_resource_drift(entry)

    assert result == case.expected
    assert result.has_drift is bool(case.expected.overwritten_fields or case.expected.topology_readds)
    assert detect_manual_edits({entry.key: entry}) is result.has_drift


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


# --- has_drifted_field with FieldChangeContext (list-element reclassification, dagshund-1naj) ---


def test_has_drifted_field_list_element_delete_with_shape_drift_returns_true() -> None:
    """Reclassified list-element delete = drift when resource has shape-based drift."""
    from dagshund.change_path import FieldChangeContext

    ctx = FieldChangeContext(
        change_key="depends_on[task_key='ingest']",
        new_state={"depends_on": [{"task_key": "transform"}]},
        remote_state={"depends_on": [{"task_key": "ingest"}]},
        resource_has_shape_drift=True,
    )
    assert has_drifted_field(make_change(action="update", remote={"task_key": "ingest"}), ctx) is True


def test_has_drifted_field_list_element_delete_without_shape_drift_returns_false() -> None:
    """Without shape drift we cannot tell 'bundle rewire' from 'manual edit' — default to not drift."""
    from dagshund.change_path import FieldChangeContext

    ctx = FieldChangeContext(
        change_key="depends_on[task_key='ingest']",
        new_state={"depends_on": [{"task_key": "transform"}]},
        remote_state={"depends_on": [{"task_key": "ingest"}]},
        resource_has_shape_drift=False,
    )
    assert has_drifted_field(make_change(action="update", remote={"task_key": "ingest"}), ctx) is False


def test_has_drifted_field_list_element_create_not_drift_even_with_shape_drift() -> None:
    """Reclassified list-element create is ambiguous with bundle-planned addition."""
    from dagshund.change_path import FieldChangeContext

    ctx = FieldChangeContext(
        change_key="depends_on[task_key='transform']",
        new_state={"depends_on": [{"task_key": "transform"}]},
        remote_state={"depends_on": []},
        resource_has_shape_drift=True,
    )
    assert has_drifted_field(make_change(action="update", new={"task_key": "transform"}), ctx) is False


def test_has_drifted_field_list_element_without_ctx_uses_shape_only() -> None:
    """Without ctx, only the shape-based predicate fires — legacy callers unchanged."""
    change = make_change(action="update", remote={"task_key": "ingest"})
    assert has_drifted_field(change) is False


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


def test_detect_manual_edits_no_changes_dict_rejected_at_parse_boundary() -> None:
    with pytest.raises(DagshundError, match="must be an object or null"):
        resources_from_dict({"resources.jobs.my_job": {"action": "update", "changes": "not a dict"}})


def test_detect_manual_edits_non_dict_field_change_rejected_at_parse_boundary() -> None:
    with pytest.raises(DagshundError, match="must be an object"):
        resources_from_dict(
            {"resources.jobs.my_job": {"action": "update", "changes": {"weird_field": "just a string"}}}
        )


def test_detect_manual_edits_empty_resources_returns_false() -> None:
    assert detect_manual_edits({}) is False


# --- detect_dangerous_actions ---


def test_detect_dangerous_actions_non_stateful_type_returns_false() -> None:
    resources = {"resources.jobs.etl_pipeline": make_resource(action="delete")}
    assert detect_dangerous_actions(resources) is False


@pytest.mark.parametrize(
    ("action", "cascade_on_destroy", "expected"),
    [
        ("delete", True, True),
        ("recreate", True, True),
        ("delete", False, False),
        ("recreate", False, False),
        ("delete", None, True),
        ("recreate", None, True),
    ],
    ids=[
        "delete-enabled",
        "recreate-enabled",
        "delete-safe",
        "recreate-safe",
        "delete-unavailable",
        "recreate-unavailable",
    ],
)
def test_detect_dangerous_actions_pipeline_cascade_risk(
    action: str,
    cascade_on_destroy: bool | None,
    expected: bool,
) -> None:
    state = {"value": {"cascade_on_destroy": cascade_on_destroy}} if cascade_on_destroy is not None else {}
    resources = {"resources.pipelines.ingest": make_resource(action=action, new_state=state)}

    assert detect_dangerous_actions(resources) is expected


@pytest.mark.parametrize("action", ["update", "create", "skip"])
def test_detect_dangerous_actions_safe_action_on_stateful_returns_false(action: str) -> None:
    resources = {"resources.schemas.analytics": make_resource(action=action)}
    assert detect_dangerous_actions(resources) is False


@pytest.mark.parametrize(
    ("new_state", "remote_state", "expected"),
    [
        ({"cascade_on_destroy": False}, None, "unavailable"),
        ({"value": {"cascade_on_destroy": False}}, {"cascade_on_destroy": True}, "safe"),
        ({"value": {"cascade_on_destroy": "unknown"}}, {"cascade_on_destroy": True}, "enabled"),
        ({"value": {}}, {"cascade_on_destroy": False}, "safe"),
        ({"value": {"cascade_on_destroy": True}}, {"cascade_on_destroy": False}, "enabled"),
    ],
    ids=[
        "bare-new-rejected",
        "wrapped-new-preferred",
        "nonboolean-new-falls-back",
        "remote-fallback",
        "boolean-new-preferred",
    ],
)
def test_classify_pipeline_cascade_risk_uses_wrapped_new_then_remote(
    new_state: object,
    remote_state: object | None,
    expected: str,
) -> None:
    entry = make_resource(
        action="delete",
        new_state=new_state,
        remote_state=remote_state,
    )

    assert classify_pipeline_cascade_risk(entry) == expected


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
