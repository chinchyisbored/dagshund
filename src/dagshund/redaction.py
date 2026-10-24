from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, cast

from dagshund.json_value import json_values_equal

REDACTED_SECRET_VALUE = "[redacted]"
_SECRET_FIELDS = frozenset({"value", "effective_value"})
_CHANGE_PAYLOAD_FIELDS = frozenset({"old", "new", "remote"})
_CHANGE_METADATA_FIELDS = frozenset({"action", "reason"})


@dataclass(frozen=True, slots=True)
class SecretComparisonFacts:
    old_new_equal: bool | None
    old_remote_equal: bool | None


def _contains_redacted_marker(value: object) -> bool:
    if isinstance(value, str):
        return REDACTED_SECRET_VALUE in value.lower()
    if isinstance(value, dict):
        return any(_contains_redacted_marker(key) or _contains_redacted_marker(item) for key, item in value.items())
    if isinstance(value, list):
        return any(_contains_redacted_marker(item) for item in value)
    return False


def _compare_known(left: object, right: object) -> bool | None:
    if _contains_redacted_marker(left) or _contains_redacted_marker(right):
        return None
    return json_values_equal(left, right)


def _is_uc_secret_key(key: str) -> bool:
    return key.startswith("resources.secrets.")


def _redact_state_fields(state: dict[str, Any]) -> dict[str, Any]:
    return {key: REDACTED_SECRET_VALUE if key in _SECRET_FIELDS else value for key, value in state.items()}


def _redact_state(raw: Any) -> Any:  # noqa: ANN401 - JSON boundary
    if raw is None:
        return raw
    # Secret states are an untrusted boundary: unknown non-null shapes must not pass through.
    if not isinstance(raw, dict):
        return REDACTED_SECRET_VALUE
    state = cast("dict[str, Any]", raw)
    wrapped = state.get("value")
    if isinstance(wrapped, dict):
        redacted_state = _redact_state_fields(state)
        return {**redacted_state, "value": _redact_state_fields(cast("dict[str, Any]", wrapped))}
    return _redact_state_fields(state)


def _redact_change_payload(value: Any) -> Any:  # noqa: ANN401 - JSON boundary
    if value == "" or (isinstance(value, str) and value.lower() == REDACTED_SECRET_VALUE):
        return value
    return REDACTED_SECRET_VALUE


def _redact_change(raw: Any) -> Any:  # noqa: ANN401 - JSON boundary
    if not isinstance(raw, dict):
        return _redact_change_payload(raw)
    change = cast("dict[str, Any]", raw)
    return {
        key: _redact_change_payload(value)
        if key in _CHANGE_PAYLOAD_FIELDS
        else value
        if key in _CHANGE_METADATA_FIELDS and (value is None or isinstance(value, str))
        else REDACTED_SECRET_VALUE
        for key, value in change.items()
    }


def _redact_changes(raw: Any) -> Any:  # noqa: ANN401 - JSON boundary
    if raw is None:
        return raw
    if not isinstance(raw, dict):
        return REDACTED_SECRET_VALUE
    changes = cast("dict[str, Any]", raw)
    return {field: _redact_change(change) if field in _SECRET_FIELDS else change for field, change in changes.items()}


def _redact_entry(raw: Any) -> Any:  # noqa: ANN401 - JSON boundary
    if raw is None:
        return raw
    # A malformed secret entry is also untrusted and must fail closed.
    if not isinstance(raw, dict):
        return REDACTED_SECRET_VALUE
    entry = cast("dict[str, Any]", raw)
    return {
        key: _redact_state(value)
        if key in {"new_state", "remote_state"}
        else _redact_changes(value)
        if key == "changes"
        else value
        for key, value in entry.items()
    }


def redact_uc_secret_values_with_facts(
    raw: Mapping[str, object],
) -> tuple[Mapping[str, object], Mapping[tuple[str, str], SecretComparisonFacts]]:
    """Redact UC secrets while retaining only safe equality facts for valid changes."""
    facts: dict[tuple[str, str], SecretComparisonFacts] = {}
    raw_plan = raw.get("plan")
    if isinstance(raw_plan, dict):
        for resource_key, entry in raw_plan.items():
            if not isinstance(resource_key, str) or not _is_uc_secret_key(resource_key) or not isinstance(entry, dict):
                continue
            changes = entry.get("changes")
            if not isinstance(changes, dict):
                continue
            for field_key, change in changes.items():
                if field_key not in _SECRET_FIELDS or not isinstance(change, dict):
                    continue
                old, new, remote = (change.get(key, _MISSING) for key in ("old", "new", "remote"))
                if old is _MISSING and new is _MISSING:
                    continue
                facts[(resource_key, field_key)] = SecretComparisonFacts(
                    _compare_known(old, new) if old is not _MISSING and new is not _MISSING else None,
                    _compare_known(old, remote) if old is not _MISSING and remote is not _MISSING else None,
                )
    return redact_uc_secret_values(raw), facts


_MISSING = object()


def redact_uc_secret_values(raw: Mapping[str, object]) -> Mapping[str, object]:
    """Return a plan with UC secret payloads redacted without mutating input."""
    raw_plan = raw.get("plan")
    if not isinstance(raw_plan, dict):
        return raw
    plan = cast("dict[str, Any]", raw_plan)
    if not any(_is_uc_secret_key(key) for key in plan):
        return raw
    redacted_plan = {key: _redact_entry(entry) if _is_uc_secret_key(key) else entry for key, entry in plan.items()}
    return {**raw, "plan": redacted_plan}
