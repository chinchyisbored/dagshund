"""Shared formatting and data pipeline functions used by text and markdown renderers."""

from collections import Counter
from collections.abc import Callable, Iterator, Mapping
from dataclasses import dataclass
from itertools import groupby
from typing import TypeGuard

from dagshund.plan import (
    DANGEROUS_ACTIONS,
    STATEFUL_RESOURCE_WARNINGS,
    action_to_diff_state,
    has_drifted_field,
)
from dagshund.types import (
    DiffState,
    FieldChange,
    ResourceChange,
    ResourceChanges,
    ResourceChangesByType,
    ResourceKey,
    ResourceType,
    parse_resource_key,
)


def is_field_changes(value: object) -> TypeGuard[dict[str, FieldChange]]:
    """Narrow the untyped 'changes' value from a resource entry so iteration preserves key/value types."""
    return isinstance(value, dict)


@dataclass(frozen=True, slots=True)
class ActionConfig:
    """Format-neutral action display configuration."""

    display: str
    symbol: str
    show_field_changes: bool = False


ACTIONS: dict[str, ActionConfig] = {
    "": ActionConfig("unchanged", " "),
    "create": ActionConfig("create", "+"),
    "delete": ActionConfig("delete", "-"),
    "update": ActionConfig("update", "~", show_field_changes=True),
    "recreate": ActionConfig("recreate", "~", show_field_changes=True),
    "resize": ActionConfig("resize", "~", show_field_changes=True),
    "update_id": ActionConfig("update_id", "~", show_field_changes=True),
    "skip": ActionConfig("unchanged", " "),
}

DEFAULT_ACTION = ActionConfig("unknown", "?")


def action_config(action: str) -> ActionConfig:
    """Return the display config for an action string."""
    return ACTIONS.get(action, DEFAULT_ACTION)


# --- Value formatting ---


_INLINE_LIMIT = 60  # collections exceeding this inline length render as multiline blocks


def _format_collection_inline(value: object) -> str:
    """Render a dict or list in human-readable form (unquoted keys, spaces).

    Caller guarantees value is a dict or list (from format_value's match).
    """
    if isinstance(value, dict):
        parts = [f"{k}: {format_value(v)}" for k, v in value.items()]
        return "{" + ", ".join(parts) + "}"
    if isinstance(value, list):
        return "[" + ", ".join(format_value(item) for item in value) + "]"
    return repr(value)


def _format_dict_block(value: object, indent: int) -> str:
    """Render a dict as indented key-value lines."""
    pad = " " * indent
    lines: list[str] = []
    if isinstance(value, dict):
        for k, v in value.items():
            inline_v = format_value(v)
            if isinstance(v, (dict, list)) and len(inline_v) > _INLINE_LIMIT:
                lines.append(f"{pad}{k}:")
                lines.append(_format_value_block(v, indent + 2))
            else:
                lines.append(f"{pad}{k}: {inline_v}")
    return "\n".join(lines)


def _format_list_block(value: object, indent: int) -> str:
    """Render a list as indented items with dash prefixes."""
    pad = " " * indent
    lines: list[str] = []
    if isinstance(value, list):
        for item in value:
            inline_item = format_value(item)
            if isinstance(item, (dict, list)) and len(inline_item) > _INLINE_LIMIT:
                lines.append(f"{pad}-")
                lines.append(_format_value_block(item, indent + 2))
            else:
                lines.append(f"{pad}- {inline_item}")
    return "\n".join(lines)


def _format_value_block(value: object, indent: int) -> str:
    """Render a value as an indented multiline block. Dispatches to dict/list helpers."""
    if isinstance(value, dict):
        return _format_dict_block(value, indent)
    if isinstance(value, list):
        return _format_list_block(value, indent)
    return f"{' ' * indent}{format_value(value)}"


def format_value(value: object) -> str:
    """Format a value for human-readable display."""
    match value:
        case None:
            return "null"
        case str():
            return f'"{value}"'
        # bool must precede int — isinstance(True, int) is True in Python
        case bool():
            return "true" if value else "false"
        case int() | float():
            return str(value)
        case dict() | list():
            return _format_collection_inline(value)
        case _:
            return repr(value)


def is_long_string(value: object) -> bool:
    """Check if a value is a string too long to display inline."""
    return isinstance(value, str) and len(value) > 40


def format_transition(old: object, new: object) -> str:
    """Format an old -> new value transition, truncating long strings."""
    old_part = "..." if is_long_string(old) else format_value(old)
    new_part = "..." if is_long_string(new) else format_value(new)
    return f": {old_part} -> {new_part}"


def format_single_value(value: object, *, block_indent: int | None = None) -> str:
    """Format a single value suffix, truncating long strings."""
    if is_long_string(value):
        return ": ..."
    inline = format_value(value)
    if block_indent is not None and isinstance(value, (dict, list)) and len(inline) > _INLINE_LIMIT:
        return ":\n" + _format_value_block(value, block_indent)
    return f": {inline}"


def format_field_suffix(change: FieldChange, *, block_indent: int | None = None) -> str | None:
    """Compute the display suffix for a field change, or None to suppress."""
    old, new = change.get("old"), change.get("new")
    has_old, has_new = "old" in change, "new" in change
    remote = change.get("remote")
    has_remote = "remote" in change

    # Drift: old == new but remote differs — show what the deploy will overwrite
    if has_old and has_new and old == new and has_remote and remote != old:
        return f": {format_value(remote)} -> {format_value(new)} (drift)"

    # No-op: old == new with no meaningful remote difference — suppress
    if has_old and has_new and old == new:
        return None

    # Remote-only: server has a value the bundle doesn't manage
    if not has_old and not has_new and has_remote:
        return f": {format_value(remote)} (remote)"

    if has_old and has_new:
        return format_transition(old, new)
    if has_new:
        return format_single_value(new, block_indent=block_indent)
    if has_old:
        return format_single_value(old, block_indent=block_indent)
    return ""


# --- Data pipeline ---


def detect_drift_fields(changes: Mapping[str, FieldChange] | None) -> list[str]:
    """Detect fields where the server state diverged from the bundle's expectation.

    A field has drifted when old and new are both defined and equal (bundle didn't
    intend to change it), and remote is present with a different value (server was edited).
    """
    if not changes:
        return []
    return sorted(
        field_name for field_name, change in changes.items() if isinstance(change, dict) and has_drifted_field(change)
    )


def _resource_type_of(entry: tuple[ResourceKey, ResourceChange]) -> ResourceType:
    """Extract the resource type from a (key, change) pair."""
    return parse_resource_key(entry[0])[0]


def group_by_resource_type(resources: ResourceChanges) -> ResourceChangesByType:
    """Group plan entries by their resource type (jobs, schemas, etc.)."""
    sorted_entries = sorted(resources.items(), key=_resource_type_of)
    grouped = groupby(sorted_entries, key=_resource_type_of)
    return {resource_type: dict(group) for resource_type, group in grouped}


def iter_visible_resources(
    resources: ResourceChanges,
    *,
    visible_states: frozenset[DiffState] | None = None,
    resource_filter: Callable[[ResourceKey, ResourceChange], bool] | None = None,
) -> Iterator[tuple[ResourceKey, ResourceChange]]:
    """Yield (key, entry) pairs matching the visibility filters."""
    for key, entry in sorted(resources.items()):
        if visible_states is not None and action_to_diff_state(entry.get("action", "")) not in visible_states:
            continue
        if resource_filter is not None and not resource_filter(key, entry):
            continue
        yield key, entry


def filter_resources(
    entries: ResourceChanges,
    *,
    visible_states: frozenset[DiffState] | None = None,
    resource_filter: Callable[[ResourceKey, ResourceChange], bool] | None = None,
) -> ResourceChanges:
    """Return entries matching both the diff state set and the resource filter predicate."""
    return dict(
        iter_visible_resources(
            entries,
            visible_states=visible_states,
            resource_filter=resource_filter,
        )
    )


def count_by_action(entries: ResourceChanges) -> dict[ActionConfig, int]:
    """Count resources grouped by action config."""
    return dict(Counter(action_config(entry.get("action", "")) for entry in entries.values()))


def format_group_header(resource_type: ResourceType, total: int, visible: int) -> str:
    """Format group header: 'type (N)' or 'type (visible/total)' when filtered."""
    count = f"({visible}/{total})" if visible != total else f"({total})"
    return f"{resource_type} {count}"


def collect_warnings(
    resources: ResourceChanges,
    *,
    visible_states: frozenset[DiffState] | None = None,
    resource_filter: Callable[[ResourceKey, ResourceChange], bool] | None = None,
) -> list[str]:
    """Collect warning messages for dangerous actions on stateful resources."""
    warnings: list[str] = []
    for key, entry in iter_visible_resources(
        resources,
        visible_states=visible_states,
        resource_filter=resource_filter,
    ):
        action = entry.get("action", "")
        if action not in DANGEROUS_ACTIONS:
            continue
        resource_type, resource_name = parse_resource_key(key)
        risk = STATEFUL_RESOURCE_WARNINGS.get(resource_type)
        if risk is None:
            continue
        action_display = action_config(action).display
        warnings.append(f"{resource_type}/{resource_name} will be {action_display}d \u2014 {risk}")
    return warnings


def collect_drift_warnings(
    resources: ResourceChanges,
    *,
    visible_states: frozenset[DiffState] | None = None,
    resource_filter: Callable[[ResourceKey, ResourceChange], bool] | None = None,
) -> list[str]:
    """Collect warnings for resources that were manually edited outside the bundle."""
    warnings: list[str] = []
    for key, entry in iter_visible_resources(
        resources,
        visible_states=visible_states,
        resource_filter=resource_filter,
    ):
        changes = entry.get("changes", {})
        if not is_field_changes(changes):
            continue
        drifted = detect_drift_fields(changes)
        if not drifted:
            continue
        resource_type, resource_name = parse_resource_key(key)
        count = len(drifted)
        noun = "field" if count == 1 else "fields"
        msg = f"{resource_type}/{resource_name} was edited outside the bundle ({count} {noun} will be overwritten)"
        warnings.append(msg)
    return warnings
