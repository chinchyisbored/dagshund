"""Semantic presentation for Databricks ``job_runs`` effects.

The plan action describes what the direct deployment engine will do with the
run resource, while the remote run state explains what that action means to a
user. Keeping both in this module lets text and browser renderers share the
same interpretation without changing action-based counts or exit codes.
"""

from collections.abc import Mapping
from dataclasses import dataclass, replace
from typing import Literal, cast

from dagshund.model import UNSET, ActionType, FieldChange, JobRunEffect

type JobRunEffectKind = Literal[
    "create",
    "recreate",
    "every-deploy",
    "completed-success",
    "legacy-skip",
    "in-progress",
    "trigger-removed",
    "delete",
    "unknown",
]


@dataclass(frozen=True, slots=True)
class JobRunEffectSemantics:
    """Display semantics derived from a run effect's action and remote state."""

    kind: JobRunEffectKind
    wording: str
    outcome: str | None = None
    state_message: str | None = None
    fires_on_deploy: bool = False
    badge_visible: bool = True


_RESULT_STATE_CHANGE_KEY = "result_state"
_TRIGGER_CHANGE_PATHS: frozenset[str] = frozenset(
    {
        "lifecycle",
        "lifecycle.triggers",
        "lifecycle.triggers.on_bundle_deploy",
    }
)
_AGGREGATE_TRIGGER_CHANGE_PATHS: frozenset[str] = frozenset({"lifecycle", "lifecycle.triggers"})
_IN_PROGRESS_LIFECYCLE_STATES: frozenset[str] = frozenset({"PENDING", "RUNNING", "TERMINATING"})
_UNSUCCESSFUL_RESULT_STATES: frozenset[str] = frozenset({"FAILED", "CANCELED", "TIMEDOUT"})
_UNSUCCESSFUL_LIFECYCLE_STATES: frozenset[str] = frozenset({"SKIPPED", "INTERNAL_ERROR"})


def _as_mapping(value: object) -> Mapping[str, object] | None:
    if not isinstance(value, Mapping):
        return None
    return cast("Mapping[str, object]", value)


def _as_non_empty_string(value: object) -> str | None:
    if not isinstance(value, str) or not value.strip():
        return None
    return value


def _extract_remote_values(effect: JobRunEffect) -> tuple[str | None, str | None, str | None]:
    remote_state = _as_mapping(effect.remote_state)
    if remote_state is None:
        return None, None, None

    state = _as_mapping(remote_state.get("state"))
    result_state = remote_state.get("result_state")
    if not isinstance(result_state, str) and state is not None:
        result_state = state.get("result_state")
    lifecycle_state = state.get("life_cycle_state") if state is not None else None
    state_message = state.get("state_message") if state is not None else None
    return (
        result_state if isinstance(result_state, str) else None,
        lifecycle_state if isinstance(lifecycle_state, str) else None,
        _as_non_empty_string(state_message),
    )


def _extract_trigger_fingerprint(value: object, path: str) -> str | None:
    if path == "lifecycle.triggers.on_bundle_deploy":
        return _as_non_empty_string(value)

    mapping = _as_mapping(value)
    if mapping is None:
        return None
    if path == "lifecycle.triggers":
        return _as_non_empty_string(mapping.get("on_bundle_deploy"))
    if path == "lifecycle":
        nested = _extract_trigger_fingerprint(mapping.get("triggers"), "lifecycle.triggers")
        return nested if nested is not None else _as_non_empty_string(mapping.get("on_bundle_deploy"))
    return None


def _is_trigger_fingerprint_change(path: str, change: FieldChange) -> bool:
    if path not in _TRIGGER_CHANGE_PATHS:
        return False
    if change.reason == "trigger removed":
        return True

    values = tuple(value for value in (change.old, change.new, change.remote) if value is not UNSET)
    return bool(values) and any(_extract_trigger_fingerprint(value, path) is not None for value in values)


def _remove_trigger_fingerprint(value: object, path: str) -> object:
    if path not in _AGGREGATE_TRIGGER_CHANGE_PATHS:
        return value
    mapping = _as_mapping(value)
    if mapping is None:
        return value

    without_direct_trigger = {key: item for key, item in mapping.items() if key != "on_bundle_deploy"}
    if path == "lifecycle.triggers":
        return without_direct_trigger

    triggers = mapping.get("triggers")
    if not isinstance(triggers, Mapping):
        return without_direct_trigger
    without_nested_trigger = _remove_trigger_fingerprint(triggers, "lifecycle.triggers")
    if isinstance(without_nested_trigger, Mapping) and without_nested_trigger:
        return {**without_direct_trigger, "triggers": without_nested_trigger}
    return {key: item for key, item in without_direct_trigger.items() if key != "triggers"}


def _has_meaningful_value(value: object) -> bool:
    return value is not UNSET and not (isinstance(value, Mapping) and not value)


def _has_meaningful_change_content(change: FieldChange) -> bool:
    return any(_has_meaningful_value(value) for value in (change.old, change.new, change.remote))


def _filter_trigger_change(path: str, change: FieldChange) -> FieldChange | None:
    if not _is_trigger_fingerprint_change(path, change):
        return change
    if path == "lifecycle.triggers.on_bundle_deploy":
        return None

    cleaned = replace(
        change,
        old=_remove_trigger_fingerprint(change.old, path),
        new=_remove_trigger_fingerprint(change.new, path),
        remote=_remove_trigger_fingerprint(change.remote, path),
    )
    return cleaned if _has_meaningful_change_content(cleaned) else None


def _is_armed_every_deploy_trigger(effect: JobRunEffect) -> bool:
    for path, change in effect.changes.items():
        if path not in _TRIGGER_CHANGE_PATHS:
            continue
        old = _extract_trigger_fingerprint(change.old, path)
        new = _extract_trigger_fingerprint(change.new, path)
        if old is not None and new is not None:
            return True
    return False


def _has_trigger_removal(effect: JobRunEffect) -> bool:
    return any(
        path in _TRIGGER_CHANGE_PATHS and change.reason == "trigger removed" for path, change in effect.changes.items()
    )


def _unsuccessful_outcome(result_state: str | None, lifecycle_state: str | None) -> str | None:
    if result_state in _UNSUCCESSFUL_RESULT_STATES:
        return result_state
    if result_state is None and lifecycle_state in _UNSUCCESSFUL_LIFECYCLE_STATES:
        return lifecycle_state
    return None


def _base_wording(kind: JobRunEffectKind, action: ActionType) -> str:
    match kind:
        case "create":
            return "runs on deploy"
        case "recreate":
            return "re-runs on deploy"
        case "every-deploy":
            return "runs on every deploy"
        case "completed-success":
            return "already ran successfully"
        case "legacy-skip":
            return "already ran"
        case "in-progress":
            return "run still in progress"
        case "trigger-removed":
            return "deploy trigger removed; no run will start"
        case "delete":
            return "run record will be deleted"
        case "unknown":
            return "unchanged" if action == ActionType.EMPTY else action.value


def _build_semantics(
    effect: JobRunEffect,
    kind: JobRunEffectKind,
    *,
    outcome: str | None = None,
    state_message: str | None = None,
) -> JobRunEffectSemantics:
    base = _base_wording(kind, effect.action)
    wording = f"{base}; previous run {outcome}" if outcome is not None else base
    fires_on_deploy = kind in {"create", "recreate", "every-deploy"}
    badge_visible = kind not in {"delete", "trigger-removed"}
    return JobRunEffectSemantics(
        kind=kind,
        wording=wording,
        outcome=outcome,
        state_message=state_message,
        fires_on_deploy=fires_on_deploy,
        badge_visible=badge_visible,
    )


def classify_job_run_effect(effect: JobRunEffect) -> JobRunEffectSemantics:
    """Classify one effect for all user-facing renderers."""
    result_state, lifecycle_state, state_message = _extract_remote_values(effect)

    if effect.action == ActionType.SKIP:
        if _has_trigger_removal(effect):
            return _build_semantics(effect, "trigger-removed")
        result_change = effect.changes.get(_RESULT_STATE_CHANGE_KEY)
        if (
            result_change is not None
            and result_change.reason == "run in progress"
            and lifecycle_state in _IN_PROGRESS_LIFECYCLE_STATES
        ):
            return _build_semantics(effect, "in-progress", state_message=state_message)
        if result_state == "SUCCESS":
            return _build_semantics(effect, "completed-success")
        return _build_semantics(effect, "legacy-skip")

    if effect.action == ActionType.RECREATE:
        outcome = _unsuccessful_outcome(result_state, lifecycle_state)
        kind: JobRunEffectKind = "every-deploy" if _is_armed_every_deploy_trigger(effect) else "recreate"
        return _build_semantics(effect, kind, outcome=outcome, state_message=state_message if outcome else None)

    if effect.action == ActionType.CREATE:
        return _build_semantics(effect, "create")
    if effect.action == ActionType.DELETE:
        return _build_semantics(effect, "delete")
    return _build_semantics(effect, "unknown")


def filter_job_run_changes(
    changes: Mapping[str, FieldChange] | None,
) -> dict[str, FieldChange]:
    """Hide result and generated trigger-fingerprint fields from effect details."""
    if changes is None:
        return {}

    visible: dict[str, FieldChange] = {}
    for path, change in changes.items():
        if path == _RESULT_STATE_CHANGE_KEY:
            continue
        filtered = _filter_trigger_change(path, change) if path in _TRIGGER_CHANGE_PATHS else change
        if filtered is not None:
            visible[path] = filtered
    return visible
