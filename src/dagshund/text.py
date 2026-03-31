"""Terminal text rendering of plan diffs."""

import os
import sys
from collections import Counter
from collections.abc import Callable, Iterator, Mapping
from dataclasses import dataclass
from itertools import groupby
from typing import TypeGuard

from dagshund.merge import merge_sub_resources
from dagshund.plan import (
    action_to_diff_state,
    detect_changes,
    has_drifted_field,
    is_resource_changes,
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
    parse_resource_key,
)


def _is_field_changes(value: object) -> TypeGuard[dict[str, FieldChange]]:
    """Narrow the untyped 'changes' value from a resource entry so iteration preserves key/value types."""
    return isinstance(value, dict)


# ANSI color codes
RESET = "\033[0m"
_BOLD = "\033[1m"
DIM = "\033[2m"
GREEN = "\033[32m"
RED = "\033[31m"
YELLOW = "\033[33m"
_CYAN = "\033[36m"


@dataclass(frozen=True, slots=True)
class _ActionConfig:
    display: str
    color: str
    symbol: str
    show_field_changes: bool = False


# Action vocabulary is duplicated in two other locations:
# - plan.py: action_to_diff_state() match statement
# - js/src/types/plan-schema.ts: knownActionTypes (Zod schema)
_ACTIONS: dict[str, _ActionConfig] = {
    "": _ActionConfig("unchanged", DIM, " "),
    "create": _ActionConfig("create", GREEN, "+"),
    "delete": _ActionConfig("delete", RED, "-"),
    "update": _ActionConfig("update", YELLOW, "~", show_field_changes=True),
    "recreate": _ActionConfig("recreate", YELLOW, "~", show_field_changes=True),
    "resize": _ActionConfig("resize", YELLOW, "~", show_field_changes=True),
    "update_id": _ActionConfig("update_id", YELLOW, "~", show_field_changes=True),
    "skip": _ActionConfig("unchanged", DIM, " "),
}

_DEFAULT_ACTION = _ActionConfig("unknown", RESET, "?")

_DANGEROUS_ACTIONS = frozenset({"delete", "recreate"})

_STATEFUL_RESOURCE_WARNINGS: dict[str, str] = {
    # Unity Catalog
    "catalogs": "all schemas, tables, and volumes in this catalog will be lost",
    "schemas": "all tables, views, and volumes in this schema will be lost",
    "volumes": "all files in this volume will be lost",
    "registered_models": "all model versions will be lost",
    "experiments": "all experiment runs and metrics will be lost",
    # PostgreSQL
    "database_instances": "all catalogs and tables on this instance will be lost",
    "postgres_projects": "all branches and endpoints in this project will be lost",
    "postgres_branches": "all data on this branch will be lost",
}


def _supports_color() -> bool:
    """Check if the terminal supports color output.

    Precedence: NO_COLOR (any value) > FORCE_COLOR (non-zero) > isatty().
    NO_COLOR spec: presence disables color regardless of value.
    FORCE_COLOR convention: "0" means unset, any other value forces color on.
    """
    if "NO_COLOR" in os.environ:
        return False
    force = os.environ.get("FORCE_COLOR", "")
    if force and force != "0":
        return True
    return sys.stdout.isatty()


def _colorize(text: str, color: str, *, use_color: bool) -> str:
    if not use_color:
        return text
    return f"{color}{text}{RESET}"


def _action_config(action: str) -> _ActionConfig:
    """Return the display config for an action string."""
    return _ACTIONS.get(action, _DEFAULT_ACTION)


def _format_value(value: object) -> str:
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
        case dict():
            return f"{{{len(value)} fields}}"
        case list():
            return f"[{len(value)} items]"
        case _:
            return repr(value)


def _is_long_string(value: object) -> bool:
    """Check if a value is a string too long to display inline."""
    return isinstance(value, str) and len(value) > 40


def _render_field_change(field_name: str, change: FieldChange, *, use_color: bool) -> str | None:
    """Render a single field-level change, or None if unchanged/no-op."""
    action = str(change.get("action", ""))
    if action_to_diff_state(action) == DiffState.UNCHANGED:
        return None

    field_config = _action_config(action)
    prefix = f"      {field_config.symbol} {field_name}"
    old, new = change.get("old"), change.get("new")
    has_old, has_new = "old" in change, "new" in change
    remote = change.get("remote")
    has_remote = "remote" in change

    # Drift: old == new but remote differs — show what the deploy will overwrite
    if has_old and has_new and old == new and has_remote and remote != old:
        suffix = f": {_format_value(remote)} -> {_format_value(new)} (drift)"
        return _colorize(f"{prefix}{suffix}", field_config.color, use_color=use_color)

    # No-op: old == new with no meaningful remote difference — suppress
    if has_old and has_new and old == new:
        return None

    # Remote-only: server has a value the bundle doesn't manage — show it
    if not has_old and not has_new and has_remote:
        suffix = f": {_format_value(remote)} (remote)"
        return _colorize(f"{prefix}{suffix}", field_config.color, use_color=use_color)

    if (has_old and _is_long_string(old)) or (has_new and _is_long_string(new)):
        old_part = "..." if _is_long_string(old) else _format_value(old) if has_old else None
        new_part = "..." if _is_long_string(new) else _format_value(new) if has_new else None
        if old_part is not None and new_part is not None:
            suffix = f": {old_part} -> {new_part}"
        elif new_part is not None:
            suffix = f": {new_part}"
        else:
            # old_part is guaranteed not None — the guard ensures at least one side is long
            suffix = f": {old_part}"
    elif has_old and has_new:
        suffix = f": {_format_value(old)} -> {_format_value(new)}"
    elif has_new:
        suffix = f": {_format_value(new)}"
    elif has_old:
        suffix = f": {_format_value(old)}"
    else:
        suffix = ""
    return _colorize(f"{prefix}{suffix}", field_config.color, use_color=use_color)


def _detect_drift_fields(changes: Mapping[str, FieldChange] | None) -> list[str]:
    """Detect fields where the server state diverged from the bundle's expectation.

    A field has drifted when old and new are both defined and equal (bundle didn't
    intend to change it), and remote is present with a different value (server was edited).
    """
    if not changes:
        return []
    return sorted(
        field_name for field_name, change in changes.items() if isinstance(change, dict) and has_drifted_field(change)
    )


def _render_resource(
    key: ResourceKey,
    entry: ResourceChange,
    *,
    use_color: bool,
) -> Iterator[str]:
    """Render a single resource entry as lines of text."""
    action = entry.get("action", "")
    action_config = _action_config(action)
    resource_type, resource_name = parse_resource_key(key)

    label = f"  ({action_config.display})" if action_to_diff_state(action) != DiffState.UNCHANGED else ""
    header = f"  {action_config.symbol} {resource_type}/{resource_name}{label}"
    yield _colorize(header, action_config.color, use_color=use_color)

    changes = entry.get("changes", {})
    if _is_field_changes(changes) and action_config.show_field_changes and _detect_drift_fields(changes):
        yield _colorize("      \u26a0 manually edited outside bundle", YELLOW, use_color=use_color)

    if _is_field_changes(changes) and changes and action_config.show_field_changes:
        for field_name, change in sorted(changes.items()):
            if not isinstance(change, dict):
                continue
            rendered = _render_field_change(field_name, change, use_color=use_color)
            if rendered is not None:
                yield rendered


def _count_by_action(entries: ResourceChanges) -> dict[_ActionConfig, int]:
    """Count resources grouped by action config."""
    return dict(Counter(_action_config(entry.get("action", "")) for entry in entries.values()))


def _print_header(plan: Plan, *, use_color: bool) -> None:
    """Print the plan version header line."""
    cli_version = plan.get("cli_version", "unknown")
    plan_version = plan.get("plan_version", "?")
    print(
        _colorize(
            f"dagshund plan (v{plan_version}, cli {cli_version})",
            _BOLD,
            use_color=use_color,
        )
    )
    print()


def _resource_type_of(entry: tuple[ResourceKey, ResourceChange]) -> ResourceType:
    """Extract the resource type from a (key, change) pair."""
    return parse_resource_key(entry[0])[0]


def _group_by_resource_type(resources: ResourceChanges) -> ResourceChangesByType:
    """Group plan entries by their resource type (jobs, schemas, etc.)."""
    sorted_entries = sorted(resources.items(), key=_resource_type_of)
    grouped = groupby(sorted_entries, key=_resource_type_of)
    return {resource_type: dict(group) for resource_type, group in grouped}


def _filter_resources(
    entries: ResourceChanges,
    *,
    visible_states: frozenset[DiffState] | None = None,
    resource_filter: Callable[[ResourceKey, ResourceChange], bool] | None = None,
) -> ResourceChanges:
    """Return entries matching both the diff state set and the resource filter predicate."""
    return dict(
        _iter_visible_resources(
            entries,
            visible_states=visible_states,
            resource_filter=resource_filter,
        )
    )


def _format_group_header(resource_type: ResourceType, total: int, visible: int) -> str:
    """Format group header: 'type (N)' or 'type (visible/total)' when filtered."""
    count = f"({visible}/{total})" if visible != total else f"({total})"
    return f"  {resource_type} {count}"


def _print_resource_groups(
    resource_groups: ResourceChangesByType,
    *,
    use_color: bool,
    visible_states: frozenset[DiffState] | None = None,
    resource_filter: Callable[[ResourceKey, ResourceChange], bool] | None = None,
) -> None:
    """Print each resource type group with its entries."""
    for resource_type, entries in resource_groups.items():  # already sorted by _group_by_resource_type
        visible = _filter_resources(entries, visible_states=visible_states, resource_filter=resource_filter)
        if not visible:
            continue

        header = _format_group_header(resource_type, len(entries), len(visible))
        print(_colorize(header, _CYAN + _BOLD, use_color=use_color))
        for key, entry in sorted(visible.items()):
            for line in _render_resource(key, entry, use_color=use_color):
                print(line)
        print()


def _format_action_count(cfg: _ActionConfig, count: int, *, use_color: bool) -> str:
    """Format a single action count like '+3 create' with color."""
    return _colorize(f"{cfg.symbol}{count} {cfg.display}", cfg.color, use_color=use_color)


def _print_summary(
    resources: ResourceChanges,
    *,
    use_color: bool,
    visible_states: frozenset[DiffState] | None = None,
    resource_filter: Callable[[ResourceKey, ResourceChange], bool] | None = None,
) -> None:
    """Print the action count summary line, filtered to visible states when provided."""
    filtered = _filter_resources(resources, visible_states=visible_states, resource_filter=resource_filter)
    sorted_counts = sorted(_count_by_action(filtered).items(), key=lambda item: item[0].display)
    parts = ", ".join(_format_action_count(cfg, count, use_color=use_color) for cfg, count in sorted_counts)
    if parts:
        print(f"  {parts}")


def _iter_visible_resources(
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


def _collect_warnings(
    resources: ResourceChanges,
    *,
    visible_states: frozenset[DiffState] | None = None,
    resource_filter: Callable[[ResourceKey, ResourceChange], bool] | None = None,
) -> list[str]:
    """Collect warning messages for dangerous actions on stateful resources."""
    warnings: list[str] = []
    for key, entry in _iter_visible_resources(
        resources,
        visible_states=visible_states,
        resource_filter=resource_filter,
    ):
        action = entry.get("action", "")
        if action not in _DANGEROUS_ACTIONS:
            continue
        resource_type, resource_name = parse_resource_key(key)
        risk = _STATEFUL_RESOURCE_WARNINGS.get(resource_type)
        if risk is None:
            continue
        action_display = _action_config(action).display
        warnings.append(f"{resource_type}/{resource_name} will be {action_display}d — {risk}")
    return warnings


def _print_warnings(warnings: list[str], *, use_color: bool) -> None:
    """Print data-loss warnings below the summary line."""
    print()
    print(_colorize("  Dangerous Actions:", RED + _BOLD, use_color=use_color))
    for warning in warnings:
        print(_colorize(f"  \u26a0 {warning}", RED, use_color=use_color))


def _collect_drift_warnings(
    resources: ResourceChanges,
    *,
    visible_states: frozenset[DiffState] | None = None,
    resource_filter: Callable[[ResourceKey, ResourceChange], bool] | None = None,
) -> list[str]:
    """Collect warnings for resources that were manually edited outside the bundle."""
    warnings: list[str] = []
    for key, entry in _iter_visible_resources(
        resources,
        visible_states=visible_states,
        resource_filter=resource_filter,
    ):
        changes = entry.get("changes", {})
        if not _is_field_changes(changes):
            continue
        drifted = _detect_drift_fields(changes)
        if not drifted:
            continue
        resource_type, resource_name = parse_resource_key(key)
        count = len(drifted)
        noun = "field" if count == 1 else "fields"
        msg = f"{resource_type}/{resource_name} was edited outside the bundle ({count} {noun} will be overwritten)"
        warnings.append(msg)
    return warnings


def _print_drift_warnings(warnings: list[str], *, use_color: bool) -> None:
    """Print drift warnings below the summary line."""
    print()
    print(_colorize("  Manual Edits Detected:", YELLOW + _BOLD, use_color=use_color))
    for warning in warnings:
        print(_colorize(f"  \u26a0 {warning}", YELLOW, use_color=use_color))


def render_text(
    plan: Plan,
    *,
    visible_states: frozenset[DiffState] | None = None,
    filter_query: str | None = None,
) -> None:
    """Render colored diff summary to terminal."""
    raw_resources = plan.get("plan", {})
    if not is_resource_changes(raw_resources):
        raise DagshundError("plan must be an object")
    resources = merge_sub_resources(raw_resources)
    if not resources:
        raise DagshundError("plan is empty")

    resource_filter = None
    if filter_query:
        from dagshund.filter import build_query_predicate

        resource_filter = build_query_predicate(filter_query)

    use_color = _supports_color()
    _print_header(plan, use_color=use_color)

    if not detect_changes(resources):
        print(
            _colorize(
                f"  No changes ({len(resources)} resources unchanged)",
                DIM,
                use_color=use_color,
            )
        )
        return

    _print_resource_groups(
        _group_by_resource_type(resources),
        use_color=use_color,
        visible_states=visible_states,
        resource_filter=resource_filter,
    )
    _print_summary(resources, use_color=use_color, visible_states=visible_states, resource_filter=resource_filter)

    warnings = _collect_warnings(resources, visible_states=visible_states, resource_filter=resource_filter)
    if warnings:
        _print_warnings(warnings, use_color=use_color)

    drift_warnings = _collect_drift_warnings(resources, visible_states=visible_states, resource_filter=resource_filter)
    if drift_warnings:
        _print_drift_warnings(drift_warnings, use_color=use_color)
