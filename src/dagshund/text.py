"""Terminal text rendering of plan diffs."""

import json
import os
import sys
from typing import Any

# ANSI color codes
RESET = "\033[0m"
BOLD = "\033[1m"
DIM = "\033[2m"
GREEN = "\033[32m"
RED = "\033[31m"
YELLOW = "\033[33m"
CYAN = "\033[36m"


def _supports_color() -> bool:
    """Check if the terminal supports color output."""
    if os.environ.get("NO_COLOR"):
        return False
    return sys.stdout.isatty()


def _colorize(text: str, color: str, *, use_color: bool) -> str:
    if not use_color:
        return text
    return f"{color}{text}{RESET}"


def _action_color(action: str) -> str:
    match action:
        case "create":
            return GREEN
        case "delete":
            return RED
        case "update" | "recreate" | "resize" | "update_id":
            return YELLOW
        case "skip" | "":
            return DIM
        case _:
            return RESET


def _action_symbol(action: str) -> str:
    match action:
        case "create":
            return "+"
        case "delete":
            return "-"
        case "update" | "recreate" | "resize" | "update_id":
            return "~"
        case "skip" | "":
            return " "
        case _:
            return "?"


def _parse_resource_key(key: str) -> tuple[str, str]:
    """Extract resource type and name from a key like 'resources.jobs.etl_pipeline'."""
    parts = key.split(".")
    if len(parts) >= 3:
        return parts[1], ".".join(parts[2:])
    if len(parts) == 2:
        return parts[0], parts[1]
    return "", key


def _format_value(value: Any) -> str:
    """Format a value for display, truncating long strings."""
    if value is None:
        return "null"
    if isinstance(value, str):
        if len(value) > 80:
            return f'"{value[:77]}..."'
        return f'"{value}"'
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int | float):
        return str(value)
    if isinstance(value, dict):
        return f"{{{len(value)} fields}}"
    if isinstance(value, list):
        return f"[{len(value)} items]"
    return repr(value)


def _render_resource(
    key: str,
    entry: dict,
    *,
    use_color: bool,
) -> list[str]:
    """Render a single resource entry as lines of text."""
    lines: list[str] = []
    action = entry.get("action", "")
    resource_type, resource_name = _parse_resource_key(key)
    color = _action_color(action)
    symbol = _action_symbol(action)

    header = f"  {symbol} {resource_type}/{resource_name}"
    if action:
        header += f"  ({action})"
    lines.append(_colorize(header, color, use_color=use_color))

    # Show field-level changes for updates
    changes = entry.get("changes", {})
    if changes and action in ("update", "recreate", "resize", "update_id"):
        for field_name, change in sorted(changes.items()):
            change_action = change.get("action", "")
            if change_action in ("skip", ""):
                continue

            field_color = _action_color(change_action)
            field_symbol = _action_symbol(change_action)
            line = f"      {field_symbol} {field_name}"

            old_val = change.get("old")
            new_val = change.get("new")
            if old_val is not None and new_val is not None:
                line += f": {_format_value(old_val)} -> {_format_value(new_val)}"
            elif new_val is not None:
                line += f": {_format_value(new_val)}"
            elif old_val is not None:
                line += f": {_format_value(old_val)}"

            lines.append(_colorize(line, field_color, use_color=use_color))

    return lines


def _count_by_action(entries: dict[str, dict]) -> dict[str, int]:
    """Count resources by action type."""
    counts: dict[str, int] = {}
    for entry in entries.values():
        action = entry.get("action", "unchanged")
        if not action:
            action = "unchanged"
        counts[action] = counts.get(action, 0) + 1
    return counts


def render_text(plan_json: str) -> None:
    """Parse plan JSON and render colored diff summary to terminal."""
    try:
        data = json.loads(plan_json)
    except json.JSONDecodeError as exc:
        print(f"dagshund: invalid JSON: {exc}", file=sys.stderr)
        sys.exit(1)

    if not isinstance(data, dict):
        print("dagshund: plan JSON must be an object", file=sys.stderr)
        sys.exit(1)

    plan = data.get("plan", {})
    if not plan:
        print("dagshund: plan is empty", file=sys.stderr)
        return

    use_color = _supports_color()

    # Header
    cli_version = data.get("cli_version", "unknown")
    plan_version = data.get("plan_version", "?")
    print(
        _colorize(
            f"dagshund plan (v{plan_version}, cli {cli_version})",
            BOLD,
            use_color=use_color,
        )
    )
    print()

    # Group by resource type
    by_type: dict[str, list[tuple[str, dict]]] = {}
    for key, entry in plan.items():
        resource_type, _ = _parse_resource_key(key)
        by_type.setdefault(resource_type, []).append((key, entry))

    # Render each group
    for resource_type in sorted(by_type):
        entries = by_type[resource_type]
        print(
            _colorize(
                f"  {resource_type} ({len(entries)})",
                CYAN + BOLD,
                use_color=use_color,
            )
        )
        for key, entry in sorted(entries, key=lambda x: x[0]):
            for line in _render_resource(key, entry, use_color=use_color):
                print(line)
        print()

    # Summary
    counts = _count_by_action(plan)
    summary_parts = []
    for action, count in sorted(counts.items()):
        color = _action_color(action)
        symbol = _action_symbol(action)
        summary_parts.append(
            _colorize(f"{symbol}{count} {action}", color, use_color=use_color)
        )
    print(f"  {', '.join(summary_parts)}")
