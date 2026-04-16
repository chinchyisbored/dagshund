"""Dagshund -- visualizer for databricks bundle plan output."""

from dagshund.merge import is_sub_resource_key, merge_sub_resources
from dagshund.model import (
    UNSET,
    ActionType,
    FieldChange,
    Plan,
    ResourceChange,
    parse_action,
    parse_field_change,
    parse_plan,
    parse_plan_data,
    parse_resource_change,
)
from dagshund.plan import (
    action_to_diff_state,
    detect_changes,
    detect_dangerous_actions,
    detect_manual_edits,
    has_drifted_field,
    is_topology_drift_change,
)
from dagshund.types import (
    DagshundError,
    DiffState,
    ResourceKey,
    ResourceType,
    parse_resource_key,
)

__all__ = [
    "UNSET",
    "ActionType",
    "DagshundError",
    "DiffState",
    "FieldChange",
    "Plan",
    "ResourceChange",
    "ResourceKey",
    "ResourceType",
    "action_to_diff_state",
    "detect_changes",
    "detect_dangerous_actions",
    "detect_manual_edits",
    "has_drifted_field",
    "is_sub_resource_key",
    "is_topology_drift_change",
    "merge_sub_resources",
    "parse_action",
    "parse_field_change",
    "parse_plan",
    "parse_plan_data",
    "parse_resource_change",
    "parse_resource_key",
]

__version__ = "0.8.0"
