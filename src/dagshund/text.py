"""Terminal text rendering of plan diffs."""

import os
import sys
from collections import Counter

from dagshund import DagshundError, Plan, ResourceChange, ResourceChangeMap, parse_plan

# ANSI color codes
RESET = "\033[0m"
BOLD = "\033[1m"
DIM = "\033[2m"
GREEN = "\033[32m"
RED = "\033[31m"
YELLOW = "\033[33m"
CYAN = "\033[36m"

UPDATE_ACTIONS: frozenset[str] = frozenset({"update", "recreate", "resize", "update_id"})


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


_DISPLAY_ACTIONS: dict[str, str] = {"skip": "unchanged", "": "unchanged"}

_ACTION_STYLES: dict[str, tuple[str, str]] = {
    "create": (GREEN, "+"),
    "delete": (RED, "-"),
    "unchanged": (DIM, " "),
    **dict.fromkeys(UPDATE_ACTIONS, (YELLOW, "~")),
}

_DEFAULT_STYLE: tuple[str, str] = (RESET, "?")


def _action_style(action: str) -> tuple[str, str]:
    """Return (color, symbol) for an action string."""
    return _ACTION_STYLES.get(action, _DEFAULT_STYLE)


def _display_action(action: str) -> str:
    """Map internal action names to user-facing display names."""
    return _DISPLAY_ACTIONS.get(action, action)


def _parse_resource_key(key: str) -> tuple[str, str]:
    """Extract resource type and name from a key like 'resources.jobs.etl_pipeline'."""
    parts = key.split(".")
    if len(parts) >= 3:
        return parts[1], ".".join(parts[2:])
    if len(parts) == 2:
        return parts[0], parts[1]
    return "", key


def _format_value(value: object) -> str:
    """Format a value for display, truncating long strings."""
    if value is None:
        return "null"
    if isinstance(value, str):
        if len(value) > 80:
            return f'"{value[:77]}..."'
        return f'"{value}"'
    if isinstance(value, bool):  # must precede int — bool is a subclass of int
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
    entry: ResourceChange,
    *,
    use_color: bool,
) -> list[str]:
    """Render a single resource entry as lines of text."""
    lines: list[str] = []
    action = _display_action(entry.get("action", ""))
    resource_type, resource_name = _parse_resource_key(key)
    color, symbol = _action_style(action)

    header = f"  {symbol} {resource_type}/{resource_name}"
    if action != "unchanged":
        header += f"  ({action})"
    lines.append(_colorize(header, color, use_color=use_color))

    # Show field-level changes for updates
    changes = entry.get("changes", {})
    if changes and action in UPDATE_ACTIONS:
        for field_name, change in sorted(changes.items()):
            change_action = _display_action(change.get("action", ""))
            if change_action == "unchanged":
                continue

            field_color, field_symbol = _action_style(change_action)
            line = f"      {field_symbol} {field_name}"

            has_old = "old" in change
            has_new = "new" in change
            if has_old and has_new:
                line += f": {_format_value(change['old'])} -> {_format_value(change['new'])}"
            elif has_new:
                line += f": {_format_value(change['new'])}"
            elif has_old:
                line += f": {_format_value(change['old'])}"

            lines.append(_colorize(line, field_color, use_color=use_color))

    return lines


def _count_by_action(entries: ResourceChangeMap) -> dict[str, int]:
    """Count resources by action type, using display names."""
    return dict(
        Counter(_display_action(entry.get("action") or "unchanged") for entry in entries.values())
    )


def _print_header(data: Plan, *, use_color: bool) -> None:
    """Print the plan version header line."""
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


def _group_by_resource_type(plan: ResourceChangeMap) -> dict[str, list[tuple[str, ResourceChange]]]:
    """Group plan entries by their resource type (jobs, schemas, etc.)."""
    by_type: dict[str, list[tuple[str, ResourceChange]]] = {}
    for key, entry in plan.items():
        resource_type, _ = _parse_resource_key(key)
        by_type.setdefault(resource_type, []).append((key, entry))
    return by_type


def _print_resource_groups(by_type: dict[str, list[tuple[str, ResourceChange]]], *, use_color: bool) -> None:
    """Print each resource type group with its entries."""
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


def _print_summary(plan: ResourceChangeMap, *, use_color: bool) -> None:
    """Print the action count summary line."""
    counts = _count_by_action(plan)
    summary_parts = []
    for action, count in sorted(counts.items()):
        color, symbol = _action_style(action)
        summary_parts.append(_colorize(f"{symbol}{count} {action}", color, use_color=use_color))
    print(f"  {', '.join(summary_parts)}")


def _all_unchanged(plan: ResourceChangeMap) -> bool:
    """Check if every resource in the plan is unchanged (skip or empty action)."""
    return all(entry.get("action", "") in ("skip", "") for entry in plan.values())


def render_text(plan_json: str) -> None:
    """Parse plan JSON and render colored diff summary to terminal."""
    data = parse_plan(plan_json)

    plan = data.get("plan", {})
    if not plan:
        raise DagshundError("plan is empty")

    use_color = _supports_color()
    _print_header(data, use_color=use_color)

    if _all_unchanged(plan):
        print(
            _colorize(
                f"  No changes ({len(plan)} resources unchanged)",
                DIM,
                use_color=use_color,
            )
        )
        return

    _print_resource_groups(_group_by_resource_type(plan), use_color=use_color)
    _print_summary(plan, use_color=use_color)
