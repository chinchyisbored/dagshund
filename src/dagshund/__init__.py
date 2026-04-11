"""Dagshund -- visualizer for databricks bundle plan output."""

from dagshund.merge import merge_sub_resources
from dagshund.plan import (
    action_to_diff_state,
    detect_changes,
    detect_dangerous_actions,
    detect_manual_edits,
    has_drifted_field,
    is_resource_changes,
    is_topology_drift_change,
    parse_plan,
)
from dagshund.types import (
    DagshundError,
    DiffState,
    FieldChange,
    Plan,
    ResourceChange,
    ResourceChanges,
    ResourceChangesByType,
    ResourceKey,
    ResourceType,
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
    "detect_dangerous_actions",
    "detect_manual_edits",
    "has_drifted_field",
    "is_resource_changes",
    "is_sub_resource_key",
    "is_topology_drift_change",
    "merge_sub_resources",
    "parse_plan",
    "parse_resource_key",
]

__version__ = "0.7.0"
