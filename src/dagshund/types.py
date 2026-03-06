"""Type aliases and domain logic for dagshund plan data."""

from enum import StrEnum
from typing import Any, TypeGuard

type ResourceKey = str
type ResourceType = str
type ResourceName = str
type FieldChange = dict[str, object]
type ResourceChange = dict[str, Any]
type ResourceChanges = dict[ResourceKey, ResourceChange]
type ResourceChangesByType = dict[ResourceType, ResourceChanges]
type Plan = dict[str, Any]


def is_resource_changes(value: object) -> TypeGuard[ResourceChanges]:
    """Runtime check that narrows Any to ResourceChanges for the type checker."""
    return isinstance(value, dict) and all(isinstance(v, dict) for v in value.values())


class DiffState(StrEnum):
    ADDED = "added"
    MODIFIED = "modified"
    REMOVED = "removed"
    UNCHANGED = "unchanged"


def action_to_diff_state(action: str) -> DiffState:
    """Map a plan action string to its diff state category."""
    match action:
        case "create":
            return DiffState.ADDED
        case "delete":
            return DiffState.REMOVED
        case "update" | "recreate" | "resize" | "update_id":
            return DiffState.MODIFIED
        case _:
            return DiffState.UNCHANGED


def parse_resource_key(key: ResourceKey) -> tuple[ResourceType, ResourceName]:
    """Extract resource type and name from a key like 'resources.jobs.etl_pipeline'."""
    match key.split("."):
        case [_, resource_type, name, *rest]:
            return resource_type, ".".join([name, *rest])
        case [resource_type, name]:
            return resource_type, name
        case _:
            return "", key
