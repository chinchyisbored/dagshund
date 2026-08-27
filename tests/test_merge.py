"""Tests for sub-resource merge behavior.

The normalize_plan target-resolution tests iterate the shared fixture at
``fixtures/job-run-effect-cases.json`` that is also consumed by the TypeScript
test at ``js/tests/utils/normalize-plan.test.ts``. Any resolution drift between
the two language implementations fails on both sides simultaneously.
"""

import copy
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, cast

import pytest
from factories import resources_from_dict

from dagshund.merge import (
    extract_parent_resource_key,
    extract_sub_resource_suffix,
    is_sub_resource_key,
    merge_sub_resources,
    normalize_plan,
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


def test_merge_sub_resources_preserves_sub_remote_state_when_new_state_differs() -> None:
    resources = resources_from_dict(
        {
            "resources.schemas.drift_grants": {
                "action": "skip",
                "new_state": {"value": {"name": "drift_grants"}},
                "remote_state": {"name": "drift_grants"},
            },
            "resources.schemas.drift_grants.grants": {
                "action": "update",
                "new_state": {
                    "value": {
                        "__embed__": [
                            {"principal": "data_readers", "privileges": ["SELECT", "USE_SCHEMA"]},
                        ],
                    },
                },
                "remote_state": {
                    "__embed__": [
                        {"principal": "account users", "privileges": ["SELECT", "USE_SCHEMA"]},
                    ],
                },
                "changes": {
                    "[principal='account users']": {
                        "action": "update",
                        "remote": {"principal": "account users", "privileges": ["SELECT", "USE_SCHEMA"]},
                    },
                },
            },
        }
    )

    result = merge_sub_resources(resources)

    merged = result["resources.schemas.drift_grants"]
    new_state = merged.new_state
    remote_state = merged.remote_state
    assert isinstance(new_state, dict)
    assert isinstance(remote_state, dict)
    new_state_mapping = cast("dict[str, Any]", new_state)
    remote_state_mapping = cast("dict[str, Any]", remote_state)
    assert new_state_mapping["value"]["grants"]["__embed__"] == [
        {"principal": "data_readers", "privileges": ["SELECT", "USE_SCHEMA"]},
    ]
    assert remote_state_mapping["grants"]["__embed__"] == [
        {"principal": "account users", "privileges": ["SELECT", "USE_SCHEMA"]},
    ]


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


# --- normalize_plan (job_runs effects, shared fixture) ---

_EFFECT_FIXTURE_PATH = Path(__file__).resolve().parent.parent / "fixtures" / "job-run-effect-cases.json"


@dataclass(frozen=True, slots=True)
class _EffectCase:
    name: str
    plan: dict[str, Any]
    effect_key: str
    expected_target: str | None


def _load_effect_cases() -> list[_EffectCase]:
    data = cast("dict[str, Any]", json.loads(_EFFECT_FIXTURE_PATH.read_text()))
    return [
        _EffectCase(
            name=c["name"],
            plan=c["plan"],
            effect_key=c["effectKey"],
            expected_target=c["expected"]["target"],
        )
        for c in data["cases"]
    ]


_EFFECT_CASES = _load_effect_cases()


@pytest.mark.parametrize("case", _EFFECT_CASES, ids=[c.name for c in _EFFECT_CASES])
def test_normalize_plan_target_resolution_shared_fixture(case: _EffectCase) -> None:
    resources = resources_from_dict(case.plan)

    normalized = normalize_plan(resources)

    effect_name = case.effect_key.split(".")[-1]
    if case.expected_target is not None:
        target = normalized[case.expected_target]
        assert effect_name in [effect.name for effect in target.effects]
        assert case.effect_key not in normalized
    else:
        # Unresolved effects stay standalone — Python has no phantom-node concept.
        assert case.effect_key in normalized


# --- normalize_plan (folding behavior) ---


def _job_with_run(run_overrides: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {
        "resources.jobs.etl": {"action": "skip", "remote_state": {"job_id": 100}},
        "resources.job_runs.nightly": {
            "depends_on": [{"node": "resources.jobs.etl"}],
            **run_overrides,
        },
    }


def test_normalize_plan_keeps_target_action_and_changes_untouched() -> None:
    resources = resources_from_dict(_job_with_run({"action": "create", "new_state": {"value": {"job_id": 100}}}))

    normalized = normalize_plan(resources)

    target = normalized["resources.jobs.etl"]
    assert target.action == ActionType.SKIP
    assert target.changes == {}
    assert target.remote_state == {"job_id": 100}


def test_normalize_plan_sorts_effects_by_name() -> None:
    resources = resources_from_dict(
        {
            "resources.jobs.etl": {"action": "skip", "remote_state": {"job_id": 100}},
            "resources.job_runs.zulu": {
                "depends_on": [{"node": "resources.jobs.etl"}],
                "action": "create",
            },
            "resources.job_runs.alpha": {
                "depends_on": [{"node": "resources.jobs.etl"}],
                "action": "skip",
            },
        }
    )

    normalized = normalize_plan(resources)

    assert [effect.name for effect in normalized["resources.jobs.etl"].effects] == ["alpha", "zulu"]


def test_normalize_plan_effect_carries_action_changes_and_run_page_url() -> None:
    resources = resources_from_dict(
        _job_with_run(
            {
                "action": "recreate",
                "new_state": {"value": {"job_id": 100, "result_state": "SUCCESS"}},
                "remote_state": {
                    "job_id": 100,
                    "result_state": "SUCCESS",
                    "run_page_url": "https://example.test/run/1",
                },
                "changes": {"job_parameters['v']": {"action": "recreate", "old": "1", "new": "2"}},
            }
        )
    )

    normalized = normalize_plan(resources)

    (effect,) = normalized["resources.jobs.etl"].effects
    assert effect.action == ActionType.RECREATE
    assert effect.run_page_url == "https://example.test/run/1"
    assert effect.new_state == {"value": {"job_id": 100, "result_state": "SUCCESS"}}
    assert effect.remote_state == {
        "job_id": 100,
        "result_state": "SUCCESS",
        "run_page_url": "https://example.test/run/1",
    }
    assert list(effect.changes) == ["job_parameters['v']"]


@pytest.mark.parametrize(
    "url",
    [
        "javascript:alert(1)",
        "https://example.test/run(1)",
        "https://example.test/a b",
        "ftp://x/y",
        "https://example.test/run\n",
    ],
    ids=["javascript-scheme", "parenthesis", "whitespace", "non-http-scheme", "trailing-newline"],
)
def test_normalize_plan_rejects_unsafe_run_page_url(url: str) -> None:
    resources = resources_from_dict(
        _job_with_run({"action": "skip", "remote_state": {"job_id": 100, "run_page_url": url}})
    )

    normalized = normalize_plan(resources)

    (effect,) = normalized["resources.jobs.etl"].effects
    assert effect.run_page_url is None


def test_normalize_plan_without_effect_entries_passes_through() -> None:
    resources = resources_from_dict({"resources.jobs.etl": {"action": "skip", "remote_state": {"job_id": 100}}})

    normalized = normalize_plan(resources)

    assert normalized["resources.jobs.etl"].effects == ()


def test_normalize_plan_runs_sub_resource_merge_first() -> None:
    resources = resources_from_dict(
        {
            "resources.jobs.etl": {"action": "skip", "remote_state": {"job_id": 100}},
            "resources.jobs.etl.permissions": {
                "action": "update",
                "changes": {"acl": {"action": "update", "old": "a", "new": "b"}},
            },
            "resources.job_runs.nightly": {
                "depends_on": [{"node": "resources.jobs.etl"}],
                "action": "create",
            },
        }
    )

    normalized = normalize_plan(resources)

    target = normalized["resources.jobs.etl"]
    assert "permissions.acl" in target.changes
    assert [effect.name for effect in target.effects] == ["nightly"]
