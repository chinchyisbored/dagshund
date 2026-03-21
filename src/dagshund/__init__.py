"""Dagshund -- visualizer for databricks bundle plan output."""

import json

from dagshund.merge import merge_sub_resources
from dagshund.types import (
    DiffState,
    FieldChange,
    Plan,
    ResourceChange,
    ResourceChanges,
    ResourceChangesByType,
    ResourceKey,
    ResourceType,
    action_to_diff_state,
    is_resource_changes,
    is_sub_resource_key,
    parse_resource_key,
)

__all__ = [
    "DagshundError",
    "DiffState",
    "FieldChange",
    "Plan",
    "ResourceChange",
    "ResourceChanges",
    "ResourceChangesByType",
    "ResourceKey",
    "ResourceType",
    "action_to_diff_state",
    "detect_changes",
    "detect_manual_edits",
    "is_resource_changes",
    "is_sub_resource_key",
    "merge_sub_resources",
    "parse_plan",
    "parse_resource_key",
]

__version__ = "0.6.0"


class DagshundError(Exception):
    """Raised for any user-facing error (bad input, missing files, etc.)."""


def detect_changes(resources: ResourceChanges) -> bool:
    """Check whether any resource has a non-skip action (i.e., drift detected)."""
    return any(entry.get("action") not in ("skip", "") for entry in resources.values())


def _has_drifted_field(change: FieldChange) -> bool:
    """Check whether a single field change represents manual drift.

    A field has drifted when old and new are both defined and equal (the bundle
    didn't intend to change it), but remote differs or is absent (someone edited
    the server state directly).

    Assumes the caller has already narrowed the type with ``isinstance(change, dict)``.
    """
    action = str(change.get("action", ""))
    if action_to_diff_state(action) == DiffState.UNCHANGED:
        return False
    if "old" not in change or "new" not in change:
        return False
    if change["old"] != change["new"]:
        return False
    return "remote" not in change or change["remote"] != change["old"]


def detect_manual_edits(resources: ResourceChanges) -> bool:
    """Check whether any resource has fields that were manually edited outside the bundle."""
    for entry in resources.values():
        changes = entry.get("changes", {})
        if not isinstance(changes, dict):
            continue
        for change in changes.values():
            if not isinstance(change, dict):
                continue
            if _has_drifted_field(change):
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
