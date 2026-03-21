"""Type aliases, enums, and domain primitives for dagshund plan data."""

from collections.abc import Mapping
from enum import StrEnum
from typing import Any

type ResourceKey = str
type ResourceType = str
type ResourceName = str
type FieldChange = Mapping[str, object]
type ResourceChange = dict[str, Any]
type ResourceChanges = dict[ResourceKey, ResourceChange]
type ResourceChangesByType = dict[ResourceType, ResourceChanges]
type Plan = dict[str, Any]


class DagshundError(Exception):
    """Raised for any user-facing error (bad input, missing files, etc.)."""


class DiffState(StrEnum):
    ADDED = "added"
    MODIFIED = "modified"
    REMOVED = "removed"
    UNCHANGED = "unchanged"
    UNKNOWN = "unknown"


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
