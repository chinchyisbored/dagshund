from enum import StrEnum

type ResourceKey = str
type ResourceType = str
type ResourceName = str


class DagshundError(Exception):
    """Raised for any user-facing error (bad input, missing files, etc.)."""


class DiffState(StrEnum):
    ADDED = "added"
    MODIFIED = "modified"
    REMOVED = "removed"
    UNCHANGED = "unchanged"
    UNKNOWN = "unknown"


def parse_resource_key(key: ResourceKey) -> tuple[ResourceType, ResourceName]:
    """Extract resource type and name from a key like 'resources.jobs.etl_pipeline'."""
    match key.split("."):
        case [_, resource_type, name, *rest]:
            return resource_type, ".".join([name, *rest])
        case [resource_type, name]:
            return resource_type, name
        case _:
            return "", key
