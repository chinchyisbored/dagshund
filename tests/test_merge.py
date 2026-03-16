from dagshund.merge import merge_sub_resources
from dagshund.types import extract_parent_resource_key, extract_sub_resource_suffix

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


# --- merge_sub_resources ---


def test_merge_sub_resources_no_subs_returns_unchanged() -> None:
    resources = {
        "resources.jobs.my_job": {"action": "create"},
        "resources.schemas.analytics": {"action": "skip"},
    }

    result = merge_sub_resources(resources)

    assert sorted(result.keys()) == ["resources.jobs.my_job", "resources.schemas.analytics"]
    assert result["resources.jobs.my_job"] == {"action": "create"}


def test_merge_sub_resources_changes_prefixed_with_suffix() -> None:
    resources = {
        "resources.jobs.my_job": {"action": "skip"},
        "resources.jobs.my_job.grants": {
            "action": "update",
            "changes": {
                "user_name": {"action": "update", "old": "old@co.com", "new": "new@co.com"},
            },
        },
    }

    result = merge_sub_resources(resources)

    assert result["resources.jobs.my_job"]["changes"] == {
        "grants.user_name": {"action": "update", "old": "old@co.com", "new": "new@co.com"},
    }


def test_merge_sub_resources_state_injected_under_suffix_in_new_state() -> None:
    resources = {
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

    result = merge_sub_resources(resources)

    new_state = result["resources.jobs.my_job"]["new_state"]
    assert new_state["value"]["permissions"] == {"access_control_list": [{"group_name": "admins"}]}
    assert new_state["value"]["name"] == "my_job"


def test_merge_sub_resources_state_injected_under_suffix_in_remote_state() -> None:
    resources = {
        "resources.jobs.my_job": {
            "action": "skip",
            "remote_state": {"name": "my_job", "job_id": 123},
        },
        "resources.jobs.my_job.permissions": {
            "action": "skip",
            "remote_state": {"access_control_list": [{"group_name": "devs"}]},
        },
    }

    result = merge_sub_resources(resources)

    remote = result["resources.jobs.my_job"]["remote_state"]
    assert remote["permissions"] == {"access_control_list": [{"group_name": "devs"}]}
    assert remote["name"] == "my_job"


def test_merge_sub_resources_action_promotion_skip_to_update() -> None:
    resources = {
        "resources.jobs.my_job": {"action": "skip"},
        "resources.jobs.my_job.grants": {
            "action": "update",
            "changes": {"user_name": {"action": "update", "old": "a", "new": "b"}},
        },
    }

    result = merge_sub_resources(resources)

    assert result["resources.jobs.my_job"]["action"] == "update"


def test_merge_sub_resources_action_stays_when_parent_already_non_skip() -> None:
    resources = {
        "resources.jobs.my_job": {"action": "create"},
        "resources.jobs.my_job.grants": {"action": "update"},
    }

    result = merge_sub_resources(resources)

    assert result["resources.jobs.my_job"]["action"] == "create"


def test_merge_sub_resources_external_deps_merged_self_referential_dropped() -> None:
    resources = {
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

    result = merge_sub_resources(resources)

    deps = result["resources.jobs.my_job"]["depends_on"]
    nodes = [d["node"] for d in deps]
    assert nodes == ["resources.schemas.analytics", "resources.schemas.other"]


def test_merge_sub_resources_depends_on_sub_resource_keys_rewritten_to_parent() -> None:
    resources = {
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

    result = merge_sub_resources(resources)

    deps = result["resources.jobs.job_a"].get("depends_on", [])
    nodes = [d["node"] for d in deps]
    assert nodes == ["resources.jobs.job_b"]


def test_merge_sub_resources_orphan_subs_kept_standalone() -> None:
    resources = {
        "resources.jobs.orphan_job.permissions": {"action": "skip"},
    }

    result = merge_sub_resources(resources)

    assert list(result.keys()) == ["resources.jobs.orphan_job.permissions"]


def test_merge_sub_resources_multiple_subs_on_same_parent() -> None:
    resources = {
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

    result = merge_sub_resources(resources)

    assert list(result.keys()) == ["resources.jobs.my_job"]
    merged = result["resources.jobs.my_job"]
    assert merged["action"] == "update"
    remote = merged["remote_state"]
    assert "permissions" in remote
    assert "grants" in remote
    assert "grants.user_name" in merged["changes"]


def test_merge_sub_resources_delete_sub_no_changes_synthesizes_whole_field() -> None:
    resources = {
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

    result = merge_sub_resources(resources)

    merged = result["resources.jobs.my_job"]
    assert merged["action"] == "update"
    assert merged["changes"]["permissions"] == {
        "action": "delete",
        "old": {
            "object_id": "/jobs/123",
            "permissions": [{"group_name": "users", "permission_level": "CAN_VIEW"}],
        },
    }


def test_merge_sub_resources_create_sub_no_changes_synthesizes_whole_field() -> None:
    resources = {
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

    result = merge_sub_resources(resources)

    merged = result["resources.jobs.my_job"]
    assert merged["action"] == "create"
    assert merged["changes"]["permissions"] == {
        "action": "create",
        "new": {
            "object_id": "/jobs/123",
            "permissions": [{"group_name": "admins", "permission_level": "CAN_MANAGE"}],
        },
    }


def test_merge_sub_resources_no_synthesis_when_sub_has_field_changes() -> None:
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

    result = merge_sub_resources(resources)

    merged = result["resources.jobs.my_job"]
    assert "permissions" not in merged["changes"]
    assert "permissions.permissions[group_name='users'].permission_level" in merged["changes"]


def test_merge_sub_resources_immutability_original_not_mutated() -> None:
    import copy

    parent = {"action": "skip", "remote_state": {"name": "my_job"}}
    sub = {"action": "update", "remote_state": {"user_name": "u"}}
    resources = {
        "resources.jobs.my_job": parent,
        "resources.jobs.my_job.grants": sub,
    }
    original_parent = copy.deepcopy(parent)

    merge_sub_resources(resources)

    assert parent == original_parent
