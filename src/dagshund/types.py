"""Type aliases for dagshund plan data."""

from typing import Any, TypeGuard

type ResourceKey = str
type ResourceType = str
type ResourceName = str
type FieldChange = dict[str, object]
type ResourceChange = dict[str, Any]
type ResourceChanges = dict[ResourceKey, ResourceChange]
type ResourceChangesByType = dict[ResourceType, list[tuple[ResourceKey, ResourceChange]]]
type Plan = dict[str, Any]


def is_resource_changes(value: object) -> TypeGuard[ResourceChanges]:
    """Runtime check that narrows Any to ResourceChanges for the type checker."""
    return isinstance(value, dict)
