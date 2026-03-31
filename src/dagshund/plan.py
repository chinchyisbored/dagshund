"""Plan parsing, change detection, and drift predicates."""

import json
from typing import TypeGuard

from dagshund.types import (
    DagshundError,
    DiffState,
    FieldChange,
    Plan,
    ResourceChanges,
)


def action_to_diff_state(action: str) -> DiffState:
    """Map a plan action string to its diff state category.

    Action vocabulary is duplicated in two other locations:
    - text.py: _ACTIONS dict (display config per action)
    - js/src/types/plan-schema.ts: knownActionTypes (Zod schema)
    """
    match action:
        case "create":
            return DiffState.ADDED
        case "delete":
            return DiffState.REMOVED
        case "update" | "recreate" | "resize" | "update_id":
            return DiffState.MODIFIED
        case "" | "skip":
            return DiffState.UNCHANGED
        case _:
            return DiffState.UNKNOWN


def is_resource_changes(value: object) -> TypeGuard[ResourceChanges]:
    """Runtime check that narrows Any to ResourceChanges for the type checker."""
    return isinstance(value, dict) and all(isinstance(v, dict) for v in value.values())


def detect_changes(resources: ResourceChanges) -> bool:
    """Check whether any resource has a non-skip action (i.e., drift detected)."""
    return any(entry.get("action") not in ("skip", "") for entry in resources.values())


def has_drifted_field(change: FieldChange) -> bool:
    """Check whether a single field change represents manual drift.

    A field has drifted when old and new are both defined and equal (the bundle
    didn't intend to change it), and remote is present with a different value
    (someone edited the server state directly).

    Assumes the caller has already narrowed the type with ``isinstance(change, dict)``.
    """
    action = str(change.get("action", ""))
    if action_to_diff_state(action) == DiffState.UNCHANGED:
        return False
    if "old" not in change or "new" not in change:
        return False
    if change["old"] != change["new"]:
        return False
    return "remote" in change and change["remote"] != change["old"]


def detect_manual_edits(resources: ResourceChanges) -> bool:
    """Check whether any resource has fields that were manually edited outside the bundle."""
    for entry in resources.values():
        changes = entry.get("changes", {})
        if not isinstance(changes, dict):
            continue
        for change in changes.values():
            if not isinstance(change, dict):
                continue
            if has_drifted_field(change):
                return True
    return False


def parse_plan(raw: str) -> Plan:
    """Parse and validate plan JSON."""
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise DagshundError(f"invalid JSON: {exc}") from exc
    except RecursionError as exc:
        raise DagshundError("plan JSON is too deeply nested") from exc

    if not isinstance(data, dict):
        raise DagshundError("plan JSON must be an object")

    return data
