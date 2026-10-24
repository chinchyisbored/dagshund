"""Borrowed resource-state extraction with explicit consumer compatibility policy."""

from collections.abc import Mapping
from typing import cast


def extract_new_state(
    state: object | None,
    *,
    allow_bare: bool = False,
) -> Mapping[str, object] | None:
    """Unwrap mapping-valued new state, optionally retaining legacy bare mappings.

    ``allow_bare`` is a consumer compatibility policy, not schema detection.
    Returned mappings are borrowed and never copied or modified.
    """
    if not isinstance(state, Mapping):
        return None
    value = state.get("value")
    if isinstance(value, Mapping):
        return cast("Mapping[str, object]", value)
    return cast("Mapping[str, object]", state) if allow_bare else None


def extract_remote_state(state: object | None) -> Mapping[str, object] | None:
    """Return a borrowed remote-state mapping without interpreting its members."""
    return cast("Mapping[str, object]", state) if isinstance(state, Mapping) else None
