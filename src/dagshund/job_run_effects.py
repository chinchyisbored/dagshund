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
    "file-change",
    "completed-success",
    "legacy-skip",
    "in-progress",
    "trigger-removed",
    "delete",
    "unknown",
]


@dataclass(frozen=True, slots=True)
class WatchedPatternDetail:
    pattern: str
    status: Literal["added", "removed", "changed"]


@dataclass(frozen=True, slots=True)
class JobRunEffectSemantics:
    """Shared run-effect semantics derived from action and remote state.

    ``fires_on_deploy`` and ``badge_visible`` are cross-language contract
    fields asserted by the shared outcome vectors. Python text renderers
    currently consume ``wording`` and ``state_message``, not these fields.
    """

    kind: JobRunEffectKind
    wording: str
    state_message: str | None = None
    fires_on_deploy: bool = False
    badge_visible: bool = True
    watched_patterns: tuple[WatchedPatternDetail, ...] = ()


_RESULT_STATE_CHANGE_KEY = "result_state"
_TRIGGER_CHANGE_PATHS: frozenset[str] = frozenset(
    {
        "lifecycle",
        "lifecycle.triggers",
        "lifecycle.triggers.on_bundle_deploy",
        "lifecycle.triggers_state",
        "lifecycle.triggers_state.on_bundle_deploy",
        "lifecycle.triggers_state.on_file_change",
    }
)
_AGGREGATE_TRIGGER_CHANGE_PATHS: frozenset[str] = frozenset(
    {"lifecycle", "lifecycle.triggers", "lifecycle.triggers_state"}
)
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
    if path in {
        "lifecycle.triggers.on_bundle_deploy",
        "lifecycle.triggers_state.on_bundle_deploy",
    }:
        return _as_non_empty_string(value)

    mapping = _as_mapping(value)
    if mapping is None:
        return None
    if path in {"lifecycle.triggers", "lifecycle.triggers_state"}:
        return _as_non_empty_string(mapping.get("on_bundle_deploy"))
    if path == "lifecycle.triggers_state.on_bundle_deploy":
        return _as_non_empty_string(value)
    if path == "lifecycle":
        modern = _extract_trigger_fingerprint(mapping.get("triggers_state"), "lifecycle.triggers_state")
        if modern is not None:
            return modern
        nested = _extract_trigger_fingerprint(mapping.get("triggers"), "lifecycle.triggers")
        return nested if nested is not None else _as_non_empty_string(mapping.get("on_bundle_deploy"))
    return None


def _decode_pattern_path(path: str) -> str | None:
    prefix = "lifecycle.triggers_state.on_file_change["
    if not path.startswith(prefix) or not path.endswith("]"):
        return None
    quoted_key = path[len(prefix) : -1]
    if not quoted_key.startswith("'"):
        return None
    key: list[str] = []
    index = 1
    while index < len(quoted_key):
        character = quoted_key[index]
        if character == "\\":
            index += 1
            if index >= len(quoted_key) or quoted_key[index] not in {"'", "\\"}:
                return None
            key.append(quoted_key[index])
        elif character == "'":
            return "".join(key) if index == len(quoted_key) - 1 else None
        else:
            key.append(character)
        index += 1
    return None


def _valid_file_change_map(value: object) -> Mapping[str, object] | None:
    mapping = _as_mapping(value)
    if mapping is None or any(_as_non_empty_string(item) is None for item in mapping.values()):
        return None
    return mapping


def _file_change_map(value: object, path: str) -> Mapping[str, object] | None:
    if value is UNSET:
        return {}
    if path == "lifecycle.triggers_state.on_file_change":
        return _valid_file_change_map(value)
    mapping = _as_mapping(value)
    if mapping is None:
        return None
    if path == "lifecycle":
        if "triggers_state" not in mapping:
            return None
        return _file_change_map(mapping["triggers_state"], "lifecycle.triggers_state")
    if path == "lifecycle.triggers_state":
        if "on_file_change" not in mapping:
            return {}
        return _valid_file_change_map(mapping["on_file_change"])
    return None


def _extract_watched_patterns(effect: JobRunEffect) -> tuple[WatchedPatternDetail, ...]:
    details: dict[str, Literal["added", "removed", "changed"]] = {}
    for path, change in effect.changes.items():
        selected = _decode_pattern_path(path)
        if selected is not None:
            old_value, new_value = change.old, change.new
            if old_value is not UNSET and _as_non_empty_string(old_value) is None:
                continue
            if new_value is not UNSET and _as_non_empty_string(new_value) is None:
                continue
            old_map = {selected: old_value} if old_value is not UNSET else {}
            new_map = {selected: new_value} if new_value is not UNSET else {}
        elif path in {"lifecycle", "lifecycle.triggers_state", "lifecycle.triggers_state.on_file_change"}:
            old_map = _file_change_map(change.old, path)
            new_map = _file_change_map(change.new, path)
            if old_map is None or new_map is None:
                continue
        else:
            continue
        for pattern in old_map.keys() | new_map.keys():
            if pattern not in old_map:
                details[pattern] = "added"
            elif pattern not in new_map:
                details[pattern] = "removed"
            elif old_map[pattern] != new_map[pattern]:
                details[pattern] = "changed"
    return tuple(WatchedPatternDetail(pattern, details[pattern]) for pattern in sorted(details))


def _is_trigger_fingerprint_change(path: str, change: FieldChange) -> bool:
    selected_pattern = _decode_pattern_path(path)
    if path not in _TRIGGER_CHANGE_PATHS and selected_pattern is None:
        return False
    if selected_pattern is not None:
        return any(
            value is not UNSET and _as_non_empty_string(value) is not None
            for value in (change.old, change.new, change.remote)
        )
    if path == "lifecycle.triggers_state.on_file_change":
        return any(_valid_file_change_map(value) is not None for value in (change.old, change.new, change.remote))
    if path in {"lifecycle", "lifecycle.triggers_state"} and any(
        _file_change_map(value, path) is not None for value in (change.old, change.new, change.remote)
    ):
        return True
    if change.reason == "trigger removed":
        return True

    values = tuple(value for value in (change.old, change.new, change.remote) if value is not UNSET)
    return bool(values) and any(_extract_trigger_fingerprint(value, path) is not None for value in values)


def _remove_bundle_fingerprint(value: object) -> object:
    return UNSET if _as_non_empty_string(value) is not None else value


def _remove_file_fingerprints(value: object) -> object:
    mapping = _as_mapping(value)
    if mapping is None:
        return value
    remaining = {key: item for key, item in mapping.items() if _as_non_empty_string(item) is None}
    return remaining if remaining else UNSET


def _remove_trigger_fingerprint(value: object, path: str) -> object:
    if path == "lifecycle.triggers_state.on_bundle_deploy":
        return _remove_bundle_fingerprint(value)
    if _decode_pattern_path(path) is not None:
        return UNSET if _as_non_empty_string(value) is not None else value
    if path == "lifecycle.triggers_state.on_file_change":
        return _remove_file_fingerprints(value)
    if path not in _AGGREGATE_TRIGGER_CHANGE_PATHS:
        return value
    mapping = _as_mapping(value)
    if mapping is None:
        return value

    if path == "lifecycle.triggers":
        return {key: item for key, item in mapping.items() if key != "on_bundle_deploy"}

    cleaned = dict(mapping)
    if path == "lifecycle":
        legacy = _as_mapping(cleaned.get("triggers"))
        modern = _as_mapping(cleaned.get("triggers_state"))
        if legacy is not None:
            remaining = {key: item for key, item in legacy.items() if key != "on_bundle_deploy"}
            if remaining:
                cleaned["triggers"] = remaining
            else:
                cleaned.pop("triggers", None)
        if modern is not None:
            remaining = {
                key: item
                for key, item in modern.items()
                if key != "on_bundle_deploy" or _as_non_empty_string(item) is None
            }
            file_changes = _remove_file_fingerprints(modern.get("on_file_change", UNSET))
            if file_changes is UNSET:
                remaining.pop("on_file_change", None)
            elif "on_file_change" in modern:
                remaining["on_file_change"] = file_changes
            if remaining:
                cleaned["triggers_state"] = remaining
            else:
                cleaned.pop("triggers_state", None)
    else:
        cleaned = {
            key: item
            for key, item in cleaned.items()
            if key != "on_bundle_deploy" or _as_non_empty_string(item) is None
        }
        file_changes = _remove_file_fingerprints(mapping.get("on_file_change", UNSET))
        if file_changes is UNSET:
            cleaned.pop("on_file_change", None)
        elif "on_file_change" in mapping:
            cleaned["on_file_change"] = file_changes
    return cleaned


def _has_meaningful_value(value: object) -> bool:
    return value is not UNSET and not (isinstance(value, Mapping) and not value)


def _has_meaningful_change_content(change: FieldChange) -> bool:
    return any(_has_meaningful_value(value) for value in (change.old, change.new, change.remote))


def _filter_trigger_change(path: str, change: FieldChange) -> FieldChange | None:
    if not _is_trigger_fingerprint_change(path, change):
        return change
    if path == "lifecycle.triggers.on_bundle_deploy":
        return None
    if path == "lifecycle.triggers_state.on_bundle_deploy":
        cleaned = replace(
            change,
            **{
                key: _remove_bundle_fingerprint(value)
                for key, value in (("old", change.old), ("new", change.new), ("remote", change.remote))
            },
        )
        return cleaned if any(value is not UNSET for value in (cleaned.old, cleaned.new, cleaned.remote)) else None

    if _decode_pattern_path(path) is not None:
        cleaned = replace(
            change,
            **{
                key: _remove_trigger_fingerprint(value, path)
                for key, value in (("old", change.old), ("new", change.new), ("remote", change.remote))
            },
        )
        return cleaned if _has_meaningful_change_content(cleaned) else None

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
        case "file-change":
            return "re-runs on deploy (file-change trigger)"
        case "completed-success":
            return "already ran successfully"
        case "legacy-skip":
            return "already ran"
        case "in-progress":
            return "run still in progress"
        case "trigger-removed":
            return "deploy trigger removed; no run will start"
        case "delete":
            return "bundle run entry will be removed"
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
    fires_on_deploy = kind in {"create", "recreate", "every-deploy", "file-change"}
    badge_visible = kind not in {"delete", "trigger-removed"}
    return JobRunEffectSemantics(
        kind=kind,
        wording=wording,
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
        patterns = _extract_watched_patterns(effect)
        every_deploy = _is_armed_every_deploy_trigger(effect)
        has_rerun_file_change = any(detail.status in {"added", "changed"} for detail in patterns)
        kind: JobRunEffectKind = (
            "every-deploy" if every_deploy else "file-change" if has_rerun_file_change else "recreate"
        )
        semantics = _build_semantics(effect, kind, outcome=outcome, state_message=state_message if outcome else None)
        return replace(semantics, watched_patterns=patterns)

    if effect.action == ActionType.CREATE:
        return replace(_build_semantics(effect, "create"), watched_patterns=_extract_watched_patterns(effect))
    if effect.action == ActionType.DELETE:
        if effect.gone is True:
            wording = "already absent; removing stale bundle state"
            return JobRunEffectSemantics("delete", wording, state_message, False, False)
        if effect.state_only is True:
            wording = "run entry removed from bundle state; run history preserved"
            return JobRunEffectSemantics("delete", wording, state_message, False, False)
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
        filtered = (
            _filter_trigger_change(path, change)
            if path in _TRIGGER_CHANGE_PATHS or _decode_pattern_path(path) is not None
            else change
        )
        if filtered is not None:
            visible[path] = filtered
    return visible
