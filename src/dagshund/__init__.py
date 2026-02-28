"""Dagshund -- visualizer for databricks bundle plan output."""

import json

from dagshund.types import (
    FieldChange,
    Plan,
    ResourceChange,
    ResourceChanges,
    ResourceChangesByType,
    ResourceKey,
    ResourceName,
    ResourceType,
    is_resource_changes,
)

__all__ = [
    "DagshundError",
    "FieldChange",
    "Plan",
    "ResourceChange",
    "ResourceChanges",
    "ResourceChangesByType",
    "ResourceKey",
    "ResourceName",
    "ResourceType",
    "detect_changes",
    "is_resource_changes",
    "parse_plan",
]

__version__ = "0.1.0"


class DagshundError(Exception):
    """Raised for any user-facing error (bad input, missing files, etc.)."""


def detect_changes(resources: ResourceChanges) -> bool:
    """Check whether any resource has a non-skip action (i.e., drift detected)."""
    return any(entry.get("action") not in ("skip", "") for entry in resources.values())


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
