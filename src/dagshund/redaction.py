from collections.abc import Mapping
from typing import Any, cast

REDACTED_SECRET_VALUE = "[redacted]"
_SECRET_FIELDS = frozenset({"value", "effective_value"})
_CHANGE_PAYLOAD_FIELDS = frozenset({"old", "new", "remote"})


def _is_uc_secret_key(key: str) -> bool:
    return key.startswith("resources.secrets.")


def _redact_state_fields(state: dict[str, Any]) -> dict[str, Any]:
    return {key: REDACTED_SECRET_VALUE if key in _SECRET_FIELDS else value for key, value in state.items()}


def _redact_state(raw: Any) -> Any:  # noqa: ANN401 - JSON boundary
    if not isinstance(raw, dict):
        return raw
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
        key: _redact_change_payload(value) if key in _CHANGE_PAYLOAD_FIELDS else value for key, value in change.items()
    }


def _redact_changes(raw: Any) -> Any:  # noqa: ANN401 - JSON boundary
    if not isinstance(raw, dict):
        return raw
    changes = cast("dict[str, Any]", raw)
    return {field: _redact_change(change) if field in _SECRET_FIELDS else change for field, change in changes.items()}


def _redact_entry(raw: Any) -> Any:  # noqa: ANN401 - JSON boundary
    if not isinstance(raw, dict):
        return raw
    entry = cast("dict[str, Any]", raw)
    return {
        key: _redact_state(value)
        if key in {"new_state", "remote_state"}
        else _redact_changes(value)
        if key == "changes"
        else value
        for key, value in entry.items()
    }


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
