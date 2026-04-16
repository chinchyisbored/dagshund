"""Tests for sub-resource merge behavior."""

import copy
from typing import Any, cast

import pytest
from factories import resources_from_dict

from dagshund.merge import (
    extract_parent_resource_key,
    extract_sub_resource_suffix,
    is_sub_resource_key,
    merge_sub_resources,
)
from dagshund.model import UNSET, ActionType

# --- extract_parent_resource_key ---


def test_extract_parent_resource_key_four_segments() -> None:
    assert extract_parent_resource_key("resources.jobs.test_job.permissions") == "resources.jobs.test_job"


def test_extract_parent_resource_key_five_segments() -> None:
    assert extract_parent_resource_key("resources.jobs.test_job.grants.extra") == "resources.jobs.test_job"


def test_extract_parent_resource_key_three_segments() -> None:
    assert extract_parent_resource_key("resources.jobs.test_job") == "resources.jobs.test_job"


def test_extract_parent_resource_key_two_segments() -> None:
    assert extract_parent_resource_key("resources.jobs") == "resources.jobs"


# --- extract_sub_resource_suffix ---


def test_extract_sub_resource_suffix_four_segments() -> None:
    assert extract_sub_resource_suffix("resources.jobs.test_job.permissions") == "permissions"


def test_extract_sub_resource_suffix_five_segments() -> None:
    assert extract_sub_resource_suffix("resources.jobs.test_job.grants.extra") == "grants.extra"


def test_extract_sub_resource_suffix_three_segments() -> None:
    assert extract_sub_resource_suffix("resources.jobs.test_job") == ""


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


# --- merge_sub_resources ---


def test_merge_sub_resources_no_subs_returns_unchanged() -> None:
    resources = resources_from_dict(
        {
            "resources.jobs.my_job": {"action": "create"},
            "resources.schemas.analytics": {"action": "skip"},
        }
    )

    result = merge_sub_resources(resources)

    assert sorted(result.keys()) == ["resources.jobs.my_job", "resources.schemas.analytics"]
    assert result["resources.jobs.my_job"].action == ActionType.CREATE


def test_merge_sub_resources_changes_prefixed_with_suffix() -> None:
    resources = resources_from_dict(
        {
            "resources.jobs.my_job": {"action": "skip"},
            "resources.jobs.my_job.grants": {
                "action": "update",
                "changes": {
                    "user_name": {"action": "update", "old": "old@co.com", "new": "new@co.com"},
                },
            },
        }
    )

    result = merge_sub_resources(resources)

    merged_changes = result["resources.jobs.my_job"].changes
    assert set(merged_changes) == {"grants.user_name"}
    change = merged_changes["grants.user_name"]
    assert change.action == ActionType.UPDATE
    assert change.old == "old@co.com"
    assert change.new == "new@co.com"


def test_merge_sub_resources_state_injected_under_suffix_in_new_state() -> None:
    resources = resources_from_dict(
        {
            "resources.jobs.my_job": {
                "action": "create",
                "new_state": {"value": {"name": "my_job", "format": "MULTI_TASK"}},
            },
            "resources.jobs.my_job.permissions": {
                "action": "skip",
                "new_state": {
                    "value": {"access_control_list": [{"group_name": "admins"}]},
                },
            },
        }
    )

    result = merge_sub_resources(resources)

    new_state = cast("dict[str, Any]", result["resources.jobs.my_job"].new_state)
    assert new_state["value"]["permissions"] == {"access_control_list": [{"group_name": "admins"}]}
    assert new_state["value"]["name"] == "my_job"


def test_merge_sub_resources_state_injected_under_suffix_in_remote_state() -> None:
    resources = resources_from_dict(
        {
            "resources.jobs.my_job": {
                "action": "skip",
                "remote_state": {"name": "my_job", "job_id": 123},
            },
            "resources.jobs.my_job.permissions": {
                "action": "skip",
                "remote_state": {"access_control_list": [{"group_name": "devs"}]},
            },
        }
    )

    result = merge_sub_resources(resources)

    remote = cast("dict[str, Any]", result["resources.jobs.my_job"].remote_state)
    assert remote["permissions"] == {"access_control_list": [{"group_name": "devs"}]}
    assert remote["name"] == "my_job"


def test_merge_sub_resources_action_promotion_skip_to_update() -> None:
    resources = resources_from_dict(
        {
            "resources.jobs.my_job": {"action": "skip"},
            "resources.jobs.my_job.grants": {
                "action": "update",
                "changes": {"user_name": {"action": "update", "old": "a", "new": "b"}},
            },
        }
    )

    result = merge_sub_resources(resources)

    assert result["resources.jobs.my_job"].action == ActionType.UPDATE


def test_merge_sub_resources_action_stays_when_parent_already_non_skip() -> None:
    resources = resources_from_dict(
        {
            "resources.jobs.my_job": {"action": "create"},
            "resources.jobs.my_job.grants": {"action": "update"},
        }
    )

    result = merge_sub_resources(resources)

    assert result["resources.jobs.my_job"].action == ActionType.CREATE


def test_merge_sub_resources_external_deps_merged_self_referential_dropped() -> None:
    resources = resources_from_dict(
        {
            "resources.jobs.my_job": {
                "action": "create",
                "depends_on": [{"node": "resources.schemas.analytics"}],
            },
            "resources.jobs.my_job.permissions": {
                "action": "skip",
                "depends_on": [
                    {"node": "resources.jobs.my_job"},
                    {"node": "resources.schemas.other"},
                ],
            },
        }
    )

    result = merge_sub_resources(resources)

    deps = result["resources.jobs.my_job"].depends_on
    nodes = [node for node, _ in deps]
    assert nodes == ["resources.schemas.analytics", "resources.schemas.other"]


def test_merge_sub_resources_depends_on_sub_resource_keys_rewritten_to_parent() -> None:
    resources = resources_from_dict(
        {
            "resources.jobs.job_a": {"action": "create"},
            "resources.jobs.job_a.permissions": {
                "action": "skip",
                "depends_on": [
                    {"node": "resources.jobs.job_a"},
                    {"node": "resources.jobs.job_b.permissions"},
                ],
            },
            "resources.jobs.job_b": {"action": "skip"},
            "resources.jobs.job_b.permissions": {
                "action": "skip",
                "depends_on": [{"node": "resources.jobs.job_b"}],
            },
        }
    )

    result = merge_sub_resources(resources)

    deps = result["resources.jobs.job_a"].depends_on
    nodes = [node for node, _ in deps]
    assert nodes == ["resources.jobs.job_b"]


def test_merge_sub_resources_orphan_subs_kept_standalone() -> None:
    resources = resources_from_dict(
        {
            "resources.jobs.orphan_job.permissions": {"action": "skip"},
        }
    )

    result = merge_sub_resources(resources)

    assert list(result.keys()) == ["resources.jobs.orphan_job.permissions"]


def test_merge_sub_resources_multiple_subs_on_same_parent() -> None:
    resources = resources_from_dict(
        {
            "resources.jobs.my_job": {"action": "skip"},
            "resources.jobs.my_job.permissions": {
                "action": "skip",
                "remote_state": {"access_control_list": []},
            },
            "resources.jobs.my_job.grants": {
                "action": "update",
                "changes": {"user_name": {"action": "update", "old": "a", "new": "b"}},
                "remote_state": {"user_name": "a"},
            },
        }
    )

    result = merge_sub_resources(resources)

    assert list(result.keys()) == ["resources.jobs.my_job"]
    merged = result["resources.jobs.my_job"]
    assert merged.action == ActionType.UPDATE
    remote = merged.remote_state
    assert isinstance(remote, dict)
    assert "permissions" in remote
    assert "grants" in remote
    assert "grants.user_name" in merged.changes


def test_merge_sub_resources_delete_sub_no_changes_synthesizes_whole_field() -> None:
    resources = resources_from_dict(
        {
            "resources.jobs.my_job": {
                "action": "skip",
                "remote_state": {"name": "my_job"},
            },
            "resources.jobs.my_job.permissions": {
                "action": "delete",
                "remote_state": {
                    "object_id": "/jobs/123",
                    "permissions": [{"group_name": "users", "permission_level": "CAN_VIEW"}],
                },
            },
        }
    )

    result = merge_sub_resources(resources)

    merged = result["resources.jobs.my_job"]
    assert merged.action == ActionType.UPDATE
    change = merged.changes["permissions"]
    assert change.action == ActionType.DELETE
    assert change.old == {
        "object_id": "/jobs/123",
        "permissions": [{"group_name": "users", "permission_level": "CAN_VIEW"}],
    }
    assert change.new is UNSET


def test_merge_sub_resources_create_sub_no_changes_synthesizes_whole_field() -> None:
    resources = resources_from_dict(
        {
            "resources.jobs.my_job": {
                "action": "create",
                "new_state": {"value": {"name": "my_job"}},
            },
            "resources.jobs.my_job.permissions": {
                "action": "create",
                "new_state": {
                    "value": {
                        "object_id": "/jobs/123",
                        "permissions": [{"group_name": "admins", "permission_level": "CAN_MANAGE"}],
                    },
                },
            },
        }
    )

    result = merge_sub_resources(resources)

    merged = result["resources.jobs.my_job"]
    assert merged.action == ActionType.CREATE
    change = merged.changes["permissions"]
    assert change.action == ActionType.CREATE
    assert change.new == {
        "object_id": "/jobs/123",
        "permissions": [{"group_name": "admins", "permission_level": "CAN_MANAGE"}],
    }
    assert change.old is UNSET


def test_merge_sub_resources_no_synthesis_when_sub_has_field_changes() -> None:
    resources = resources_from_dict(
        {
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
    )

    result = merge_sub_resources(resources)

    merged = result["resources.jobs.my_job"]
    assert "permissions" not in merged.changes
    assert "permissions.permissions[group_name='users'].permission_level" in merged.changes


def test_merge_sub_resources_immutability_original_not_mutated() -> None:
    raw_resources = {
        "resources.jobs.my_job": {"action": "skip", "remote_state": {"name": "my_job"}},
        "resources.jobs.my_job.grants": {"action": "update", "remote_state": {"user_name": "u"}},
    }
    snapshot = copy.deepcopy(raw_resources)
    typed = resources_from_dict(raw_resources)

    merge_sub_resources(typed)

    # Frozen dataclasses cannot be mutated; the raw dict fixture is untouched.
    assert raw_resources == snapshot
