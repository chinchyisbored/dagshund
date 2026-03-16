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
    UNKNOWN = "unknown"


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


def extract_parent_resource_key(key: ResourceKey) -> ResourceKey:
    """Extract the parent resource key (first 3 dot-segments) from a sub-resource key.

    'resources.jobs.test_job.permissions' → 'resources.jobs.test_job'
    """
    return ".".join(key.split(".")[:3])


def extract_sub_resource_suffix(key: ResourceKey) -> str:
    """Extract the sub-resource suffix (segments from index 3) from a sub-resource key.

    'resources.jobs.test_job.permissions' → 'permissions'
    """
    return ".".join(key.split(".")[3:])


def is_sub_resource_key(key: ResourceKey) -> bool:
    """Check whether a key represents a sub-resource (e.g. permissions, grants) rather than a top-level resource.

    Sub-resources have >3 dot segments like 'resources.jobs.test_job.permissions'.
    """
    return len(key.split(".")) > 3


def parse_resource_key(key: ResourceKey) -> tuple[ResourceType, ResourceName]:
    """Extract resource type and name from a key like 'resources.jobs.etl_pipeline'."""
    match key.split("."):
        case [_, resource_type, name, *rest]:
            return resource_type, ".".join([name, *rest])
        case [resource_type, name]:
            return resource_type, name
        case _:
            return "", key
