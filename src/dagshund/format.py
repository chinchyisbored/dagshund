"""Shared formatting and data pipeline functions used by text and markdown renderers."""

import re
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
    is_topology_drift_change,
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


@dataclass(frozen=True, slots=True)
class DriftSummary:
    """Structured summary of drift on one resource: field overwrites + sub-entity re-adds."""

    resource_type: str
    resource_name: str
    overwritten_field_count: int
    # Sorted (noun, label) pairs. e.g. ("task", "transform"), ("grant", "data_engineers").
    reentries: tuple[tuple[str, str], ...]


ACTIONS: dict[str, ActionConfig] = {
    "": ActionConfig("unchanged", "="),
    "create": ActionConfig("create", "+"),
    "delete": ActionConfig("delete", "-"),
    "update": ActionConfig("update", "~", show_field_changes=True),
    "recreate": ActionConfig("recreate", "~", show_field_changes=True),
    "resize": ActionConfig("resize", "~", show_field_changes=True),
    "update_id": ActionConfig("update_id", "~", show_field_changes=True),
    "skip": ActionConfig("unchanged", "="),
}

REMOTE_ONLY_ACTION = ActionConfig("remote", "=")
DEFAULT_ACTION = ActionConfig("unknown", "?")


def action_config(action: str) -> ActionConfig:
    """Return the display config for an action string."""
    return ACTIONS.get(action, DEFAULT_ACTION)


def field_action_config(change: FieldChange) -> ActionConfig:
    """Derive the display config for a field change from data presence, not the action label.

    The Databricks CLI reports 'update' for fields within an updated resource even when
    the field itself is new (only 'new', no 'old') or removed (only 'old', no 'new').
    Derive the effective action from the data shape: new-only → create, old-only → delete,
    both → update.
    """
    action = str(change.get("action", ""))
    base = ACTIONS.get(action, DEFAULT_ACTION)

    # Only override for actions that show field changes — resource-level symbols are fine
    if not base.show_field_changes:
        return base

    has_old, has_new = "old" in change, "new" in change
    if has_new and not has_old:
        return ACTIONS["create"]
    if has_old and not has_new:
        return ACTIONS["delete"]
    if not has_old and not has_new and "remote" in change:
        return REMOTE_ONLY_ACTION
    return base


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


def format_display_value(value: object) -> str:
    """Format a value for display, truncating long strings to ellipsis."""
    return "..." if is_long_string(value) else format_value(value)


def format_transition(old: object, new: object) -> str:
    """Format an old -> new value transition, truncating long strings."""
    return f": {format_display_value(old)} -> {format_display_value(new)}"


def _format_collection_summary(value: dict | list) -> str:
    """Summarize a large collection as '{N fields}' or '[N items]'."""
    if isinstance(value, dict):
        return f"{{{len(value)} fields}}"
    return f"[{len(value)} items]"


def format_single_value(value: object) -> str:
    """Format a single value suffix, truncating long strings and large collections."""
    if is_long_string(value):
        return ": ..."
    inline = format_value(value)
    if isinstance(value, (dict, list)) and len(inline) > _INLINE_LIMIT:
        return f": {_format_collection_summary(value)}"
    return f": {inline}"


def format_field_suffix(change: FieldChange) -> str | None:
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
        return format_single_value(new)
    if has_old:
        return format_single_value(old)
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


# Captures optional noun segment + single-quoted label in final bracket group.
# Works for "tasks[task_key='t']", "grants.[principal='p']", "foo.bar[k='v']",
# and "[principal='x']" (fallback to "entity").
_DRIFT_KEY_RE = re.compile(r"(?:^|\.)([A-Za-z_][A-Za-z0-9_]*)?\.?\[[^\[\]]*'([^']*)'\][^\[\]]*$")


def _singularize(plural: str) -> str:
    """Singularize a collection noun for observed plan.json collection names.

    Unknown shapes round-trip unchanged. Handles ``libraries -> library`` (ies→y)
    and ``tasks -> task`` / ``grants -> grant`` (s→). Preserves ``*ss`` endings
    (e.g. ``class``) to avoid mangling them into ``clas``.
    """
    if plural.endswith("ies"):
        return f"{plural[:-3]}y"
    if plural.endswith("s") and not plural.endswith("ss"):
        return plural[:-1]
    return plural


def _extract_drift_label_noun(key: str) -> tuple[str, str]:
    """Extract a (noun, label) pair from a topology-drift change key.

    Unknown shape falls back to ``("entity", key)``.
    """
    match = _DRIFT_KEY_RE.search(key)
    if match is None:
        return "entity", key
    noun_raw, label = match.group(1), match.group(2)
    return (_singularize(noun_raw) if noun_raw else "entity"), label


def detect_drift_reentries(
    changes: Mapping[str, FieldChange] | None,
) -> list[tuple[str, str]]:
    """Return topology-drift ``(noun, label)`` pairs, sorted for stable output."""
    if not changes:
        return []
    pairs: list[tuple[str, str]] = []
    for key, change in changes.items():
        if not isinstance(change, dict):
            continue
        if not is_topology_drift_change(change):
            continue
        pairs.append(_extract_drift_label_noun(key))
    pairs.sort()
    return pairs


def iter_non_topology_field_changes(
    changes: Mapping[str, FieldChange],
) -> Iterator[tuple[str, FieldChange]]:
    """Yield sorted field changes with topology-drift entries excluded.

    Single source of truth for the ``field vs re-add`` partition shared by the
    terminal and markdown renderers.
    """
    for name, change in sorted(changes.items()):
        if not isinstance(change, dict):
            continue
        if is_topology_drift_change(change):
            continue
        yield name, change


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


def _summarize_resource_drift(key: ResourceKey, entry: ResourceChange) -> DriftSummary | None:
    """Build a DriftSummary for one resource, or None when nothing drifted."""
    changes = entry.get("changes", {})
    if not is_field_changes(changes):
        return None
    overwritten = len(detect_drift_fields(changes))
    reentries = tuple(detect_drift_reentries(changes))
    if overwritten == 0 and not reentries:
        return None
    resource_type, resource_name = parse_resource_key(key)
    return DriftSummary(
        resource_type=resource_type,
        resource_name=resource_name,
        overwritten_field_count=overwritten,
        reentries=reentries,
    )


def collect_drift_summaries(
    resources: ResourceChanges,
    *,
    visible_states: frozenset[DiffState] | None = None,
    resource_filter: Callable[[ResourceKey, ResourceChange], bool] | None = None,
) -> list[DriftSummary]:
    """Collect structured drift summaries for resources edited outside the bundle."""
    visible = iter_visible_resources(resources, visible_states=visible_states, resource_filter=resource_filter)
    return [summary for key, entry in visible if (summary := _summarize_resource_drift(key, entry))]


def format_drift_subline_body(count: int, noun: str, suffix: str, labels: str = "") -> str:
    """Build the shared body of a drift sub-line: '1 task will be re-added (transform)'.

    Renderers wrap this with their own prefix ('      ' for terminal, '>   - ' for
    markdown nested bullets). Centralizing the pluralization + labels logic keeps
    the copy in lockstep across outputs.
    """
    plural = noun if count == 1 else f"{noun}s"
    body = f"{count} {plural} will be {suffix}"
    return f"{body} ({labels})" if labels else body
