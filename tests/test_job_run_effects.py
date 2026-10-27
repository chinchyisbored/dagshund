"""Tests for semantic job_runs effect classification and visible fields."""

import json
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any, cast

import pytest
from factories import make_change, resources_from_dict

from dagshund.job_run_effects import classify_job_run_effect, filter_job_run_changes
from dagshund.merge import build_job_run_effect, normalize_plan
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


def _effect_for_case(case: JobRunOutcomeCase, *, target_attached: bool) -> JobRunEffect:
    resources = resources_from_dict(case.plan)
    if target_attached:
        normalized = normalize_plan(resources)
        effect_name = case.effect_key.split(".")[-1]
        for entry in normalized.values():
            for effect in entry.effects:
                if effect.name == effect_name:
                    return effect
        raise AssertionError(f"effect {effect_name!r} was not folded onto a target")
    entry = resources[case.effect_key]
    return build_job_run_effect(case.effect_key.split(".")[-1], entry)


@pytest.mark.parametrize("case", _CASES, ids=lambda case: case.name)
@pytest.mark.parametrize("target_attached", [False, True], ids=["standalone", "attached"])
def test_classify_job_run_effect_shared_vectors(case: JobRunOutcomeCase, target_attached: bool) -> None:
    effect = _effect_for_case(case, target_attached=target_attached)

    semantics = classify_job_run_effect(effect)
    expected = case.expected

    assert semantics.kind == expected["kind"]
    assert semantics.wording == expected["wording"]
    assert semantics.state_message == expected.get("stateMessage")
    assert semantics.fires_on_deploy == expected["firesOnDeploy"]
    assert semantics.badge_visible == expected["badgeVisible"]
    assert [
        {"pattern": detail.pattern, "status": detail.status} for detail in semantics.watched_patterns
    ] == expected.get("watchedPatterns", [])
    visible_changes = filter_job_run_changes(effect.changes)
    assert list(visible_changes) == expected["visibleChangeKeys"]
    if "visibleChanges" in expected:
        assert {
            path: {
                key: getattr(change, key).value
                if isinstance(getattr(change, key), ActionType)
                else getattr(change, key)
                for key in ("action", "old", "new", "remote", "reason")
                if getattr(change, key) is not UNSET and getattr(change, key) is not None
            }
            for path, change in visible_changes.items()
        } == expected["visibleChanges"]
    if "runPageUrl" in expected:
        assert effect.run_page_url == expected["runPageUrl"]


def test_classify_modern_every_deploy_leaf_hides_fingerprint() -> None:
    effect = JobRunEffect(
        name="modern-leaf",
        action=ActionType.RECREATE,
        changes={
            "lifecycle.triggers_state.on_bundle_deploy": make_change(
                ActionType.RECREATE, old="old-uuid", new="new-uuid"
            )
        },
    )

    semantics = classify_job_run_effect(effect)

    assert semantics.kind == "every-deploy"
    assert semantics.wording == "runs on every deploy"
    assert filter_job_run_changes(effect.changes) == {}


@pytest.mark.parametrize(
    ("path", "old", "new", "expected"),
    [
        ("lifecycle.triggers_state.on_bundle_deploy", "SENTINEL_UUID", {"unexpected": 2}, {"new": {"unexpected": 2}}),
        (
            "lifecycle.triggers_state",
            {"on_bundle_deploy": "SENTINEL_UUID"},
            {"on_bundle_deploy": {"unexpected": 2}},
            {"new": {"on_bundle_deploy": {"unexpected": 2}}},
        ),
        (
            "lifecycle",
            {"triggers_state": {"on_bundle_deploy": "SENTINEL_UUID"}},
            {"triggers_state": {"on_bundle_deploy": {"unexpected": 2}}},
            {"new": {"triggers_state": {"on_bundle_deploy": {"unexpected": 2}}}},
        ),
    ],
)
def test_filter_modern_bundle_fingerprint_preserves_malformed_side(
    path: str, old: object, new: object, expected: dict[str, object]
) -> None:
    effect = JobRunEffect(
        name="malformed-modern-trigger",
        action=ActionType.RECREATE,
        changes={path: make_change(ActionType.RECREATE, old=old, new=new)},
    )

    visible = filter_job_run_changes(effect.changes)

    assert classify_job_run_effect(effect).kind == "recreate"
    assert len(visible) == 1
    change = visible[path]
    assert {key: getattr(change, key) for key in expected} == expected
    assert "SENTINEL_UUID" not in repr(visible)


@pytest.mark.parametrize(
    ("fingerprint_side", "malformed_side"),
    [("old", "new"), ("old", "remote"), ("new", "old"), ("new", "remote"), ("remote", "old"), ("remote", "new")],
)
def test_filter_modern_bundle_fingerprint_preserves_empty_object_side(
    fingerprint_side: str, malformed_side: str
) -> None:
    values: dict[str, object] = {fingerprint_side: "SENTINEL_UUID", malformed_side: {}}
    path = "lifecycle.triggers_state.on_bundle_deploy"
    effect = JobRunEffect(
        name="empty-malformed-modern-trigger",
        action=ActionType.RECREATE,
        changes={
            path: make_change(
                ActionType.RECREATE,
                old=values.get("old", UNSET),
                new=values.get("new", UNSET),
                remote=values.get("remote", UNSET),
            )
        },
    )

    visible = filter_job_run_changes(effect.changes)

    expected = make_change(
        ActionType.RECREATE,
        old={} if malformed_side == "old" else UNSET,
        new={} if malformed_side == "new" else UNSET,
        remote={} if malformed_side == "remote" else UNSET,
    )
    assert visible == {path: expected}


def test_classify_modern_file_trigger_suppresses_hashes_and_preserves_pattern_details() -> None:
    pattern = "configs/[prod].yaml"
    effect = JobRunEffect(
        name="modern",
        action=ActionType.RECREATE,
        changes={
            "lifecycle.triggers_state": make_change(
                ActionType.RECREATE,
                old={"on_file_change": {pattern: "hash-before"}, "pause_statuses": ["PAUSED"]},
                new={"on_file_change": {pattern: "hash-after"}, "pause_statuses": ["UNPAUSED"]},
            ),
            "lifecycle.triggers_state.on_file_change": make_change(
                ActionType.RECREATE,
                old={pattern: "hash-before"},
                new={pattern: "hash-after"},
            ),
        },
    )

    semantics = classify_job_run_effect(effect)
    visible = filter_job_run_changes(effect.changes)

    assert semantics.kind == "file-change"
    assert semantics.wording == "re-runs on deploy (file-change trigger)"
    assert [(detail.pattern, detail.status) for detail in semantics.watched_patterns] == [(pattern, "changed")]
    assert visible["lifecycle.triggers_state"].old == {"pause_statuses": ["PAUSED"]}
    assert visible["lifecycle.triggers_state"].new == {"pause_statuses": ["UNPAUSED"]}
    assert "lifecycle.triggers_state.on_file_change" not in visible
    assert "hash-before" not in repr(visible)


def test_classify_modern_file_trigger_addition_and_every_deploy_precedence() -> None:
    effect = JobRunEffect(
        name="armed",
        action=ActionType.RECREATE,
        changes={
            "lifecycle.triggers_state": make_change(
                ActionType.RECREATE,
                old={"on_bundle_deploy": "old-uuid"},
                new={"on_bundle_deploy": "uuid", "on_file_change": {"*.json": "hash"}},
            )
        },
    )

    semantics = classify_job_run_effect(effect)

    assert semantics.kind == "every-deploy"
    assert [(detail.pattern, detail.status) for detail in semantics.watched_patterns] == [("*.json", "added")]


def test_classify_quoted_pattern_selector_handles_dots_and_brackets() -> None:
    pattern = "configs/[prod].yaml"
    effect = JobRunEffect(
        name="selected",
        action=ActionType.RECREATE,
        changes={
            f"lifecycle.triggers_state.on_file_change['{pattern}']": make_change(
                ActionType.RECREATE, old="before", new="after"
            )
        },
    )

    semantics = classify_job_run_effect(effect)

    assert [(detail.pattern, detail.status) for detail in semantics.watched_patterns] == [(pattern, "changed")]
    assert semantics.kind == "file-change"
    assert filter_job_run_changes(effect.changes) == {}


@pytest.mark.parametrize(
    ("old", "new", "expected_status", "expected_kind"),
    [(UNSET, "hash", "added", "file-change"), ("hash", UNSET, "removed", "recreate")],
)
def test_quoted_pattern_selector_tracks_membership(
    old: object, new: object, expected_status: str, expected_kind: str
) -> None:
    effect = JobRunEffect(
        name="membership",
        action=ActionType.RECREATE,
        changes={
            "lifecycle.triggers_state.on_file_change['*.yaml']": make_change(ActionType.RECREATE, old=old, new=new)
        },
    )

    semantics = classify_job_run_effect(effect)

    assert semantics.kind == expected_kind
    assert [(detail.pattern, detail.status) for detail in semantics.watched_patterns] == [("*.yaml", expected_status)]


def test_first_arming_aggregate_and_create_keep_pattern_details() -> None:
    for path, new in (
        ("lifecycle", {"triggers_state": {"on_file_change": {"*.yaml": "hash"}}}),
        ("lifecycle.triggers_state", {"on_file_change": {"*.yaml": "hash"}}),
        ("lifecycle.triggers_state.on_file_change", {"*.yaml": "hash"}),
    ):
        effect = JobRunEffect(
            name="first-arm",
            action=ActionType.RECREATE,
            changes={path: make_change(ActionType.RECREATE, new=new)},
        )
        semantics = classify_job_run_effect(effect)
        assert semantics.kind == "file-change"
        assert [(detail.pattern, detail.status) for detail in semantics.watched_patterns] == [("*.yaml", "added")]

    created = JobRunEffect(
        name="created",
        action=ActionType.CREATE,
        changes={
            "lifecycle.triggers_state.on_file_change": make_change(ActionType.CREATE, old={}, new={"*.yaml": "hash"})
        },
    )
    create_semantics = classify_job_run_effect(created)
    assert create_semantics.wording == "runs on deploy"
    assert [(detail.pattern, detail.status) for detail in create_semantics.watched_patterns] == [("*.yaml", "added")]


def test_filter_quoted_pattern_selector_hides_only_generated_fingerprint() -> None:
    pattern = "configs/[prod]'s\\archive.yaml"
    encoded_pattern = pattern.replace("\\", "\\\\").replace("'", "\\'")
    path = f"lifecycle.triggers_state.on_file_change['{encoded_pattern}']"
    effect = JobRunEffect(
        name="selected",
        action=ActionType.RECREATE,
        changes={path: make_change(ActionType.RECREATE, old="hash-before", new="hash-after")},
    )

    semantics = classify_job_run_effect(effect)

    assert [(detail.pattern, detail.status) for detail in semantics.watched_patterns] == [(pattern, "changed")]
    assert filter_job_run_changes(effect.changes) == {}


def test_filter_malformed_and_user_authored_file_change_paths_remain_visible() -> None:
    malformed_path = "lifecycle.triggers_state.on_file_change['unterminated]"
    changes = {
        malformed_path: make_change(ActionType.RECREATE, old="hash-before", new="hash-after"),
        "lifecycle.triggers_state.on_file_change": make_change(
            ActionType.RECREATE,
            old={"pattern": {"unexpected": "nested"}},
            new={"pattern": {"unexpected": "different"}},
        ),
        "lifecycle.triggers.on_file_change": make_change(
            ActionType.RECREATE,
            old={"include": ["*.yaml"]},
            new={"include": ["*.json"]},
        ),
    }

    assert filter_job_run_changes(changes) == changes
    assert classify_job_run_effect(
        JobRunEffect(name="malformed", action=ActionType.RECREATE, changes=changes)
    ).kind == ("recreate")


def test_first_arming_whole_file_map_classifies_and_hides_fingerprint() -> None:
    effect = JobRunEffect(
        name="whole-map-first-arm",
        action=ActionType.RECREATE,
        changes={
            "lifecycle.triggers_state.on_file_change": make_change(ActionType.RECREATE, new={"*.yaml": "new-hash"})
        },
    )

    semantics = classify_job_run_effect(effect)

    assert semantics.kind == "file-change"
    assert [(detail.pattern, detail.status) for detail in semantics.watched_patterns] == [("*.yaml", "added")]
    assert filter_job_run_changes(effect.changes) == {}


def test_filter_mixed_valid_and_malformed_file_trigger_sides_independently() -> None:
    cases = (
        (
            "lifecycle.triggers_state.on_file_change",
            make_change(ActionType.RECREATE, old={"*.yaml": "old-hash"}, new={"*.yaml": {"bad": 2}}),
            UNSET,
            {"*.yaml": {"bad": 2}},
        ),
        (
            "lifecycle.triggers_state.on_file_change['*.yaml']",
            make_change(ActionType.RECREATE, old={"bad": 1}, new="new-hash"),
            {"bad": 1},
            UNSET,
        ),
        (
            "lifecycle.triggers_state.on_file_change",
            make_change(ActionType.RECREATE, old=None, new={"*.yaml": "new-hash"}),
            None,
            UNSET,
        ),
        (
            "lifecycle.triggers_state.on_file_change['*.yaml']",
            make_change(ActionType.RECREATE, old=None, new="new-hash"),
            None,
            UNSET,
        ),
    )
    for path, change, expected_old, expected_new in cases:
        visible = filter_job_run_changes({path: change})
        assert visible == {path: make_change(ActionType.RECREATE, old=expected_old, new=expected_new)}


def test_classify_removed_only_file_pattern_does_not_claim_file_rerun() -> None:
    effect = JobRunEffect(
        name="removed",
        action=ActionType.RECREATE,
        changes={
            "lifecycle.triggers_state.on_file_change": make_change(
                ActionType.RECREATE,
                old={"obsolete/*.yaml": "old-hash"},
                new={},
            )
        },
    )

    semantics = classify_job_run_effect(effect)

    assert semantics.kind == "recreate"
    assert semantics.wording == "re-runs on deploy"
    assert [(detail.pattern, detail.status) for detail in semantics.watched_patterns] == [
        ("obsolete/*.yaml", "removed")
    ]


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
