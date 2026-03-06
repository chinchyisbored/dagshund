"""Terminal text rendering of plan diffs."""

import os
import sys
from collections import Counter
from collections.abc import Iterator
from dataclasses import dataclass
from enum import StrEnum
from itertools import groupby

from dagshund import (
    DagshundError,
    FieldChange,
    Plan,
    ResourceChange,
    ResourceChanges,
    ResourceChangesByType,
    ResourceKey,
    ResourceName,
    ResourceType,
    detect_changes,
    is_resource_changes,
)

# ANSI color codes
RESET = "\033[0m"
_BOLD = "\033[1m"
DIM = "\033[2m"
GREEN = "\033[32m"
RED = "\033[31m"
YELLOW = "\033[33m"
_CYAN = "\033[36m"


class DiffState(StrEnum):
    ADDED = "added"
    MODIFIED = "modified"
    REMOVED = "removed"
    UNCHANGED = "unchanged"


def _action_to_diff_state(action: str) -> DiffState:
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


@dataclass(frozen=True, slots=True)
class _ActionConfig:
    display: str
    color: str
    symbol: str
    show_field_changes: bool = False


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
    "catalogs": "all schemas, tables, and volumes in this catalog will be lost",
    "schemas": "all tables, views, and volumes in this schema will be lost",
    "volumes": "all files in this volume will be lost",
    "registered_models": "all model versions will be lost",
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


def _parse_resource_key(key: ResourceKey) -> tuple[ResourceType, ResourceName]:
    """Extract resource type and name from a key like 'resources.jobs.etl_pipeline'."""
    match key.split("."):
        case [_, resource_type, name, *rest]:
            return resource_type, ".".join([name, *rest])
        case [resource_type, name]:
            return resource_type, name
        case _:
            return "", key


def _format_value(value: object) -> str:
    """Format a value for display, truncating long strings."""
    match value:
        case None:
            return "null"
        case str() if len(value) > 80:
            return f'"{value[:77]}..."'
        case str():
            return f'"{value}"'
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


def _render_field_change(field_name: str, change: FieldChange, *, use_color: bool) -> str | None:
    """Render a single field-level change, or None if unchanged."""
    action = str(change.get("action", ""))
    if _action_to_diff_state(action) == DiffState.UNCHANGED:
        return None

    field_config = _action_config(action)
    prefix = f"      {field_config.symbol} {field_name}"
    match ("old" in change, "new" in change):
        case (True, True):
            suffix = f": {_format_value(change['old'])} -> {_format_value(change['new'])}"
        case (False, True):
            suffix = f": {_format_value(change['new'])}"
        case (True, False):
            suffix = f": {_format_value(change['old'])}"
        case _:
            suffix = ""
    return _colorize(f"{prefix}{suffix}", field_config.color, use_color=use_color)


def _render_resource(
    key: ResourceKey,
    entry: ResourceChange,
    *,
    use_color: bool,
) -> Iterator[str]:
    """Render a single resource entry as lines of text."""
    action = entry.get("action", "")
    action_config = _action_config(action)
    resource_type, resource_name = _parse_resource_key(key)

    label = f"  ({action_config.display})" if _action_to_diff_state(action) != DiffState.UNCHANGED else ""
    header = f"  {action_config.symbol} {resource_type}/{resource_name}{label}"
    yield _colorize(header, action_config.color, use_color=use_color)

    changes = entry.get("changes", {})
    if isinstance(changes, dict) and changes and action_config.show_field_changes:
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
    return _parse_resource_key(entry[0])[0]


def _group_by_resource_type(resources: ResourceChanges) -> ResourceChangesByType:
    """Group plan entries by their resource type (jobs, schemas, etc.)."""
    sorted_entries = sorted(resources.items(), key=_resource_type_of)
    grouped = groupby(sorted_entries, key=_resource_type_of)
    return {resource_type: dict(group) for resource_type, group in grouped}


def _filter_by_diff_state(entries: ResourceChanges, visible_states: frozenset[DiffState]) -> ResourceChanges:
    """Return only entries whose diff state is in the visible set."""
    return {k: v for k, v in entries.items() if _action_to_diff_state(v.get("action", "")) in visible_states}


def _format_group_header(resource_type: ResourceType, total: int, visible: int) -> str:
    """Format group header: 'type (N)' or 'type (visible/total)' when filtered."""
    count = f"({visible}/{total})" if visible != total else f"({total})"
    return f"  {resource_type} {count}"


def _print_resource_groups(
    resource_groups: ResourceChangesByType,
    *,
    use_color: bool,
    visible_states: frozenset[DiffState] | None = None,
) -> None:
    """Print each resource type group with its entries."""
    for resource_type, entries in resource_groups.items():  # already sorted by _group_by_resource_type
        visible = _filter_by_diff_state(entries, visible_states) if visible_states is not None else entries
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
    resources: ResourceChanges, *, use_color: bool, visible_states: frozenset[DiffState] | None = None
) -> None:
    """Print the action count summary line, filtered to visible states when provided."""
    filtered = _filter_by_diff_state(resources, visible_states) if visible_states is not None else resources
    sorted_counts = sorted(_count_by_action(filtered).items(), key=lambda item: item[0].display)
    parts = ", ".join(_format_action_count(cfg, count, use_color=use_color) for cfg, count in sorted_counts)
    if parts:
        print(f"  {parts}")


def _collect_warnings(resources: ResourceChanges, *, visible_states: frozenset[DiffState] | None = None) -> list[str]:
    """Collect warning messages for dangerous actions on stateful resources."""
    warnings: list[str] = []
    for key, entry in sorted(resources.items()):
        action = entry.get("action", "")
        if action not in _DANGEROUS_ACTIONS:
            continue
        if visible_states is not None and _action_to_diff_state(action) not in visible_states:
            continue
        resource_type, resource_name = _parse_resource_key(key)
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


def render_text(plan: Plan, *, visible_states: frozenset[DiffState] | None = None) -> None:
    """Render colored diff summary to terminal."""
    resources = plan.get("plan", {})
    if not is_resource_changes(resources):
        raise DagshundError("plan must be an object")
    if not resources:
        raise DagshundError("plan is empty")

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

    _print_resource_groups(_group_by_resource_type(resources), use_color=use_color, visible_states=visible_states)
    _print_summary(resources, use_color=use_color, visible_states=visible_states)

    warnings = _collect_warnings(resources, visible_states=visible_states)
    if warnings:
        _print_warnings(warnings, use_color=use_color)
