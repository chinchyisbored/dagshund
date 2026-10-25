import copy
import json
from pathlib import Path
from typing import Any, cast

import pytest
from factories import make_change, make_resource, resource_from_dict

from dagshund.model import UNSET, ActionType, FieldChange
from dagshund.wheel import WheelUpdate, format_wheel_update
from dagshund.wheel_suppression import apply_wheel_suppression

_FIXTURE_PATH = Path(__file__).resolve().parent.parent / "fixtures" / "wheel-suppression-cases.json"
_RAW_PLAN_PATH = Path(__file__).resolve().parent.parent / "fixtures" / "wheel-suppression-raw-plan.json"


def _wheel(old: str, new: str) -> FieldChange:
    return make_change("update", old=old, new=new)


def test_apply_wheel_suppression_keeps_mixed_changes_and_summarizes_resources() -> None:
    old = "/artifacts/lib-1.0-py3-none-any.whl"
    new = "/artifacts/lib-2.0-py3-none-any.whl"
    resources = {
        "resources.jobs.first": make_resource(
            action="update",
            changes={
                "tasks[task_key='same'].libraries[0].whl": _wheel(old, new),
                "permissions[0].level": make_change("update", old="CAN_VIEW", new="CAN_MANAGE"),
            },
        ),
        "resources.jobs.second": make_resource(
            action="update",
            changes={"tasks[task_key='same'].libraries[1].whl": _wheel(old, new)},
        ),
    }

    result = apply_wheel_suppression(resources)

    assert result.resources["resources.jobs.first"].action == ActionType.UPDATE
    assert set(result.resources["resources.jobs.first"].changes) == {"permissions[0].level"}
    assert result.resources["resources.jobs.second"].action == ActionType.SKIP
    assert result.usages[0].task_count == 2
    assert result.resources["resources.jobs.first"] is not resources["resources.jobs.first"]
    assert len(resources["resources.jobs.first"].changes) == 2


def test_apply_wheel_suppression_shared_vectors_match_expected_projection() -> None:
    from dagshund.merge import normalize_plan

    fixture = cast("dict[str, Any]", json.loads(_FIXTURE_PATH.read_text()))
    for case in fixture["cases"]:
        resources = {key: resource_from_dict(key, raw) for key, raw in case["resources"].items()}
        original = copy.deepcopy(resources)
        normalized = normalize_plan(resources)
        normalized_snapshot = copy.deepcopy(normalized)

        result = apply_wheel_suppression(normalized)
        assert resources == original
        assert normalized == normalized_snapshot
        expected = case["expected"]

        assert {key: entry.action.value for key, entry in result.resources.items()} == expected["actions"]
        assert {key: sorted(entry.changes) for key, entry in result.resources.items()} == expected["remainingChanges"]
        if "remainingPayloads" in expected:
            assert {
                key: {
                    change_key: {
                        name: value
                        for name, value in (
                            ("action", change.action.value),
                            ("old", change.old),
                            ("new", change.new),
                            ("remote", change.remote),
                        )
                        if name == "action" or value is not UNSET
                    }
                    for change_key, change in result.resources[key].changes.items()
                }
                for key in expected["remainingPayloads"]
            } == expected["remainingPayloads"]
        assert [
            {
                "distribution": usage.update.distribution,
                "oldRequirement": usage.update.old_requirement,
                "newRequirement": usage.update.new_requirement,
                "taskCount": usage.task_count,
                "environmentCount": usage.environment_count,
                "pipelineCount": usage.pipeline_count,
            }
            for usage in result.usages
        ] == expected["usages"]


@pytest.mark.parametrize(
    "action",
    ["create", "delete", "recreate", "resize", "update_id", "unknown"],
)
def test_apply_wheel_suppression_preserves_resource_action_boundaries(action: str) -> None:
    key = "resources.jobs.job"
    resources = {
        key: make_resource(
            action=action,
            changes={
                "tasks[task_key='task'].libraries[0].whl": _wheel(
                    "/a/lib-1.0-py3-none-any.whl", "/a/lib-2.0-py3-none-any.whl"
                )
            },
        )
    }

    result = apply_wheel_suppression(resources)

    assert result.resources[key] == resources[key]
    assert result.usages == ()


def test_apply_wheel_suppression_projects_complete_normalized_raw_plan() -> None:
    from dagshund.merge import normalize_plan
    from dagshund.model import parse_plan_data

    raw = cast("dict[str, Any]", json.loads(_RAW_PLAN_PATH.read_text()))
    raw_snapshot = copy.deepcopy(raw)
    parsed = parse_plan_data(raw)
    normalized = normalize_plan(parsed.resources)

    normalized_snapshot = copy.deepcopy(normalized)
    result = apply_wheel_suppression(normalized)

    assert raw == raw_snapshot
    assert normalized == normalized_snapshot
    job = result.resources["resources.jobs.job"]
    assert job.action == ActionType.UPDATE
    assert job.changes == {
        key: change
        for key, change in normalized["resources.jobs.job"].changes.items()
        if not key.endswith(".libraries[0].whl") and not key.endswith(".spec.dependencies[0]")
    }
    assert "permissions.[0].level" in job.changes
    assert job.changes["tasks[task_key='loop'].depends_on[0]"].old == [{"task_key": "before"}]
    assert job.changes["tasks[task_key='loop'].depends_on[0]"].new == [{"task_key": "after"}]
    assert job.changes["tasks[task_key='run'].run_job_task.job_id"].new == 11
    assert job.changes["tasks[task_key='pipeline'].pipeline_task.pipeline_id"].new == "after-pipeline"
    new_job_tasks = cast("dict[str, Any]", job.new_state)["value"]["tasks"]
    remote_job_tasks = cast("dict[str, Any]", job.remote_state)["tasks"]
    assert {task["task_key"] for task in new_job_tasks} == {"loop", "run", "pipeline"}
    assert {task["task_key"] for task in remote_job_tasks} == {"loop", "run", "pipeline"}
    assert cast("dict[str, Any]", result.resources["resources.jobs.target"].remote_state)["job_id"] == 11
    assert job.effects == normalized["resources.jobs.job"].effects
    assert job.effects[0].changes == normalized["resources.jobs.job"].effects[0].changes
    assert result.resources["resources.job_runs.orphan"] == normalized["resources.job_runs.orphan"]
    assert result.resources["resources.job_runs.orphan"].action == ActionType.CREATE
    assert result.resources["resources.jobs.target"] == normalized["resources.jobs.target"]
    pipeline = result.resources["resources.pipelines.pipeline"]
    assert pipeline.action == ActionType.UPDATE
    assert cast("dict[str, Any]", pipeline.new_state)["value"]["pipeline_id"] == "after-pipeline"
    assert (pipeline.new_state, pipeline.remote_state, pipeline.depends_on) == (
        normalized["resources.pipelines.pipeline"].new_state,
        normalized["resources.pipelines.pipeline"].remote_state,
        normalized["resources.pipelines.pipeline"].depends_on,
    )
    assert pipeline.changes == {
        key: change for key, change in normalized["resources.pipelines.pipeline"].changes.items() if key == "continuous"
    }
    assert set(pipeline.changes) == {"continuous"}
    assert (job.new_state, job.remote_state, job.depends_on) == (
        normalized["resources.jobs.job"].new_state,
        normalized["resources.jobs.job"].remote_state,
        normalized["resources.jobs.job"].depends_on,
    )
    assert sorted((u.task_count, u.environment_count, u.pipeline_count) for u in result.usages) == [
        (0, 0, 1),
        (0, 0, 1),
        (0, 1, 0),
        (1, 0, 0),
    ]


def test_apply_wheel_suppression_preserves_states_and_counts_nested_carriers() -> None:
    resources = {
        "resources.jobs.job": make_resource(
            action="update",
            depends_on=(("resources.jobs.other", "managed"),),
            new_state={"value": {"tasks": [{"task_key": "loop"}]}},
            remote_state={"tasks": [{"task_key": "loop"}]},
            changes={
                "tasks[task_key='loop'].for_each_task.task.libraries[0].whl": _wheel(
                    "/a/lib-1.0-py3-none-any.whl", "/a/lib-2.0-py3-none-any.whl"
                ),
                "environments[environment_key='serverless'].spec.dependencies[0]": _wheel(
                    "/a/env-1.0-py3-none-any.whl", "/a/env-2.0-py3-none-any.whl"
                ),
                "tasks[task_key='loop'].depends_on[0]": make_change(
                    "update", old={"task_key": "old"}, new={"task_key": "new"}
                ),
            },
        ),
        "resources.pipelines.pipeline": make_resource(
            action="update",
            changes={
                "environment.dependencies[0]": _wheel(
                    "/a/pipeline-1.0-py3-none-any.whl", "/a/pipeline-2.0-py3-none-any.whl"
                )
            },
        ),
    }
    original = resources.copy()

    result = apply_wheel_suppression(resources)

    assert resources == original
    assert result.resources["resources.jobs.job"].new_state == resources["resources.jobs.job"].new_state
    assert result.resources["resources.jobs.job"].depends_on == (("resources.jobs.other", "managed"),)
    assert "tasks[task_key='loop'].depends_on[0]" in result.resources["resources.jobs.job"].changes
    assert sorted((u.task_count, u.environment_count, u.pipeline_count) for u in result.usages) == [
        (0, 0, 1),
        (0, 1, 0),
        (1, 0, 0),
    ]


def test_apply_wheel_suppression_preserves_unknown_action_evidence() -> None:
    resources = {
        "resources.jobs.job": make_resource(
            action="update",
            changes={
                "tasks[task_key='task'].libraries[0].whl": _wheel(
                    "/a/lib-1.0-py3-none-any.whl", "/a/lib-2.0-py3-none-any.whl"
                ),
                "opaque": make_change("future-action", old="same", new="same", remote="same"),
            },
        )
    }

    result = apply_wheel_suppression(resources)

    assert result.resources["resources.jobs.job"].action == ActionType.UPDATE
    assert result.resources["resources.jobs.job"].changes["opaque"].action == ActionType.UNKNOWN


def test_apply_wheel_suppression_sorts_case_sensitive_requirements() -> None:
    resources = {
        "resources.jobs.job": make_resource(
            action="update",
            changes={
                "tasks[task_key='lower'].libraries[0].whl": _wheel(
                    "/a/lib-1.0-py3-none-any.whl", "/a/lib-2.0-py3-none-any.whl"
                ),
                "tasks[task_key='upper'].libraries[0].whl": _wheel(
                    "/A/lib-1.0-py3-none-any.whl", "/A/lib-2.0-py3-none-any.whl"
                ),
            },
        )
    }

    result = apply_wheel_suppression(resources)

    assert [usage.update.old_requirement for usage in result.usages] == [
        "/A/lib-1.0-py3-none-any.whl",
        "/a/lib-1.0-py3-none-any.whl",
    ]


def test_format_wheel_update_disambiguates_equal_and_colliding_versions() -> None:
    first = WheelUpdate("lib", "1.0", "2.0", "/A/lib-1.0.whl", "/A/lib-2.0.whl")
    second = WheelUpdate("lib", "1.0", "2.0", "/a/lib-1.0.whl", "/a/lib-2.0.whl")
    equal = WheelUpdate("lib", "1.0", "1.0", "/old/lib-1.0.whl", "/new/lib-1.0.whl")

    assert format_wheel_update(first, (first, second)) == ("lib: /A/lib-1.0.whl → /A/lib-2.0.whl")
    assert format_wheel_update(equal, (equal,)) == ("lib: /old/lib-1.0.whl → /new/lib-1.0.whl")


def test_apply_wheel_suppression_requires_update_resource_and_known_carriers() -> None:
    wheel_key = "tasks[task_key='task'].libraries[0].whl"
    wheel = _wheel("lib-1.0-py3-none-any.whl", "lib-2.0-py3-none-any.whl")
    resources = {
        "resources.jobs.created": make_resource(action="create", changes={wheel_key: wheel}),
        "resources.pipelines.pipeline": make_resource(action="update", changes={"libraries[0].whl": wheel}),
        "resources.jobs.unknown": make_resource(action="unknown", changes={wheel_key: wheel}),
    }

    result = apply_wheel_suppression(resources)

    assert result.resources["resources.jobs.created"] == resources["resources.jobs.created"]
    assert result.resources["resources.jobs.unknown"] == resources["resources.jobs.unknown"]
    assert result.resources["resources.pipelines.pipeline"].action == ActionType.SKIP
    assert result.usages[0].pipeline_count == 1
