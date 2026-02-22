"""Terminal text rendering of plan diffs."""

import os
import sys
from collections import Counter
from collections.abc import Iterator
from dataclasses import dataclass
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
BOLD = "\033[1m"
DIM = "\033[2m"
GREEN = "\033[32m"
RED = "\033[31m"
YELLOW = "\033[33m"
CYAN = "\033[36m"


@dataclass(frozen=True, slots=True)
class _ActionConfig:
    display: str
    color: str
    symbol: str
    show_field_changes: bool = False
    changed: bool = True


_ACTIONS: dict[str, _ActionConfig] = {
    "create": _ActionConfig("create", GREEN, "+"),
    "delete": _ActionConfig("delete", RED, "-"),
    "update": _ActionConfig("update", YELLOW, "~", show_field_changes=True),
    "recreate": _ActionConfig("recreate", YELLOW, "~", show_field_changes=True),
    "resize": _ActionConfig("resize", YELLOW, "~", show_field_changes=True),
    "update_id": _ActionConfig("update_id", YELLOW, "~", show_field_changes=True),
    "skip": _ActionConfig("unchanged", DIM, " ", changed=False),
}

_DEFAULT_ACTION = _ActionConfig("unknown", RESET, "?", changed=False)


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
    field_cfg = _action_config(str(change.get("action", "")))
    if not field_cfg.changed:
        return None

    prefix = f"      {field_cfg.symbol} {field_name}"
    match ("old" in change, "new" in change):
        case (True, True):
            suffix = f": {_format_value(change['old'])} -> {_format_value(change['new'])}"
        case (False, True):
            suffix = f": {_format_value(change['new'])}"
        case (True, False):
            suffix = f": {_format_value(change['old'])}"
        case _:
            suffix = ""
    return _colorize(f"{prefix}{suffix}", field_cfg.color, use_color=use_color)


def _render_resource(
    key: ResourceKey,
    entry: ResourceChange,
    *,
    use_color: bool,
) -> Iterator[str]:
    """Render a single resource entry as lines of text."""
    cfg = _action_config(entry.get("action", ""))
    resource_type, resource_name = _parse_resource_key(key)

    label = f"  ({cfg.display})" if cfg.changed else ""
    header = f"  {cfg.symbol} {resource_type}/{resource_name}{label}"
    yield _colorize(header, cfg.color, use_color=use_color)

    changes = entry.get("changes", {})
    if isinstance(changes, dict) and changes and cfg.show_field_changes:
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
            BOLD,
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
    return {resource_type: dict(group) for resource_type, group in groupby(sorted_entries, key=_resource_type_of)}


def _print_resource_groups(resource_groups: ResourceChangesByType, *, use_color: bool) -> None:
    """Print each resource type group with its entries."""
    for resource_type in sorted(resource_groups):
        entries = resource_groups[resource_type]
        print(
            _colorize(
                f"  {resource_type} ({len(entries)})",
                CYAN + BOLD,
                use_color=use_color,
            )
        )
        for key, entry in sorted(entries.items()):
            for line in _render_resource(key, entry, use_color=use_color):
                print(line)
        print()


def _format_action_count(cfg: _ActionConfig, count: int, *, use_color: bool) -> str:
    """Format a single action count like '+3 create' with color."""
    return _colorize(f"{cfg.symbol}{count} {cfg.display}", cfg.color, use_color=use_color)


def _print_summary(resources: ResourceChanges, *, use_color: bool) -> None:
    """Print the action count summary line."""
    sorted_counts = sorted(_count_by_action(resources).items(), key=lambda item: item[0].display)
    parts = ", ".join(_format_action_count(cfg, count, use_color=use_color) for cfg, count in sorted_counts)
    print(f"  {parts}")


def _check_all_unchanged(resources: ResourceChanges) -> bool:
    """Check if every resource in the plan is unchanged (skip or empty action)."""
    return not detect_changes(resources)


def render_text(plan: Plan) -> None:
    """Render colored diff summary to terminal."""
    resources = plan.get("plan", {})
    if not is_resource_changes(resources):
        raise DagshundError("plan must be an object")
    if not resources:
        raise DagshundError("plan is empty")

    use_color = _supports_color()
    _print_header(plan, use_color=use_color)

    if _check_all_unchanged(resources):
        print(
            _colorize(
                f"  No changes ({len(resources)} resources unchanged)",
                DIM,
                use_color=use_color,
            )
        )
        return

    _print_resource_groups(_group_by_resource_type(resources), use_color=use_color)
    _print_summary(resources, use_color=use_color)
