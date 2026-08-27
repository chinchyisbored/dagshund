"""Tests for semantic job_runs effect classification and visible fields."""

import json
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any, cast

import pytest
from factories import make_change, resources_from_dict

from dagshund.job_run_effects import classify_job_run_effect, filter_job_run_changes
from dagshund.merge import normalize_plan
from dagshund.model import UNSET, ActionType, JobRunEffect

type RawPlan = Mapping[str, Mapping[str, Any]]
type ExpectedValues = Mapping[str, Any]


@dataclass(frozen=True, slots=True)
class JobRunOutcomeCase:
    name: str
    plan: RawPlan
    effect_key: str
    expected: ExpectedValues


_FIXTURE_PATH = Path(__file__).resolve().parent.parent / "fixtures" / "job-run-outcome-cases.json"
_FIXTURE = cast("Mapping[str, Any]", json.loads(_FIXTURE_PATH.read_text()))
_CASES = tuple(
    JobRunOutcomeCase(
        name=cast("str", raw_case["name"]),
        plan=cast("RawPlan", raw_case["plan"]),
        effect_key=cast("str", raw_case["effectKey"]),
        expected=cast("ExpectedValues", raw_case["expected"]),
    )
    for raw_case in cast("list[Mapping[str, Any]]", _FIXTURE["cases"])
)


def _effect_for_case(case: JobRunOutcomeCase) -> JobRunEffect:
    resources = resources_from_dict(case.plan)
    normalized = normalize_plan(resources)
    effect_name = case.effect_key.split(".")[-1]
    for entry in normalized.values():
        for effect in entry.effects:
            if effect.name == effect_name:
                return effect
    raise AssertionError(f"effect {effect_name!r} was not folded onto a target")


@pytest.mark.parametrize("case", _CASES, ids=lambda case: case.name)
def test_classify_job_run_effect_shared_vectors(case: JobRunOutcomeCase) -> None:
    effect = _effect_for_case(case)

    semantics = classify_job_run_effect(effect)
    expected = case.expected

    assert semantics.kind == expected["kind"]
    assert semantics.wording == expected["wording"]
    assert semantics.outcome == expected.get("outcome")
    assert semantics.state_message == expected.get("stateMessage")
    assert semantics.fires_on_deploy == expected["firesOnDeploy"]
    assert semantics.badge_visible == expected["badgeVisible"]
    assert list(filter_job_run_changes(effect.changes)) == expected["visibleChangeKeys"]
    if "runPageUrl" in expected:
        assert effect.run_page_url == expected["runPageUrl"]


def test_classify_job_run_effect_legacy_skip_keeps_backward_compatible_wording() -> None:
    effect = JobRunEffect(name="legacy", action=ActionType.SKIP)

    semantics = classify_job_run_effect(effect)

    assert semantics.wording == "already ran"
    assert semantics.kind == "legacy-skip"


def test_filter_job_run_changes_preserves_unrelated_lifecycle_payload() -> None:
    effect = JobRunEffect(
        name="mixed",
        action=ActionType.RECREATE,
        changes={
            "lifecycle": make_change(
                ActionType.RECREATE,
                old={"triggers": {"on_bundle_deploy": "old"}, "timeout_seconds": 10},
                new={"triggers": {"on_bundle_deploy": "new"}, "timeout_seconds": 20},
            ),
            "lifecycle.triggers.on_bundle_deploy": make_change(
                ActionType.RECREATE,
                old="old",
                new="new",
            ),
            "job_parameters['region']": make_change(
                ActionType.RECREATE,
                old="us",
                new="eu",
            ),
        },
    )

    visible = filter_job_run_changes(effect.changes)

    assert list(visible) == ["lifecycle", "job_parameters['region']"]


def test_filter_job_run_changes_mixed_armed_aggregate_classifies_and_strips_only_fingerprint() -> None:
    old = {"triggers": {"on_bundle_deploy": "old-fingerprint"}, "timeout_seconds": 10}
    new = {"triggers": {"on_bundle_deploy": "new-fingerprint"}, "timeout_seconds": 20}
    remote = {"triggers": {"on_bundle_deploy": "remote-fingerprint"}, "timeout_seconds": 30}
    change = make_change(ActionType.RECREATE, old=old, new=new, remote=remote)
    effect = JobRunEffect(name="mixed", action=ActionType.RECREATE, changes={"lifecycle": change})

    semantics = classify_job_run_effect(effect)
    visible = filter_job_run_changes(effect.changes)

    assert semantics.kind == "every-deploy"
    assert semantics.wording == "runs on every deploy"
    assert visible["lifecycle"].old == {"timeout_seconds": 10}
    assert visible["lifecycle"].new == {"timeout_seconds": 20}
    assert visible["lifecycle"].remote == {"timeout_seconds": 30}
    assert change.old == old
    assert change.new == new
    assert change.remote == remote


def test_filter_job_run_changes_mixed_trigger_removal_keeps_unrelated_lifecycle_content() -> None:
    change = make_change(
        ActionType.SKIP,
        reason="trigger removed",
        old={
            "triggers": {"on_bundle_deploy": "old-fingerprint", "pause_statuses": ["PAUSED"]},
            "prevent_destroy": True,
        },
        remote={
            "triggers": {"on_bundle_deploy": "remote-fingerprint", "pause_statuses": ["UNPAUSED"]},
            "prevent_destroy": False,
        },
    )
    effect = JobRunEffect(name="removed", action=ActionType.SKIP, changes={"lifecycle": change})

    semantics = classify_job_run_effect(effect)
    visible = filter_job_run_changes(effect.changes)

    assert semantics.kind == "trigger-removed"
    assert semantics.wording == "deploy trigger removed; no run will start"
    assert visible["lifecycle"].old == {
        "triggers": {"pause_statuses": ["PAUSED"]},
        "prevent_destroy": True,
    }
    assert visible["lifecycle"].new is UNSET
    assert visible["lifecycle"].remote == {
        "triggers": {"pause_statuses": ["UNPAUSED"]},
        "prevent_destroy": False,
    }
    assert change.old == {
        "triggers": {"on_bundle_deploy": "old-fingerprint", "pause_statuses": ["PAUSED"]},
        "prevent_destroy": True,
    }


def test_filter_job_run_changes_trigger_only_aggregate_is_removed() -> None:
    changes = {
        "lifecycle.triggers": make_change(
            ActionType.RECREATE,
            old={"on_bundle_deploy": "old-fingerprint"},
            new={"on_bundle_deploy": "new-fingerprint"},
        )
    }

    visible = filter_job_run_changes(changes)

    assert visible == {}


def test_filter_job_run_changes_lifecycle_without_trigger_is_unchanged() -> None:
    change = make_change(
        ActionType.RECREATE,
        old={"timeout_seconds": 10},
        new={"timeout_seconds": 20},
        remote={"timeout_seconds": 10},
    )

    visible = filter_job_run_changes({"lifecycle": change})

    assert visible["lifecycle"] is change
    assert visible["lifecycle"].old == {"timeout_seconds": 10}
    assert visible["lifecycle"].new == {"timeout_seconds": 20}
    assert visible["lifecycle"].remote == {"timeout_seconds": 10}
