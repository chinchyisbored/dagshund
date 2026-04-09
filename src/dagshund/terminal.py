"""Terminal text rendering of plan diffs."""

import os
import sys
import textwrap
from collections.abc import Callable, Iterator

from dagshund.format import (
    ActionConfig,
    action_config,
    collect_drift_warnings,
    collect_warnings,
    count_by_action,
    detect_drift_fields,
    filter_resources,
    format_display_value,
    format_field_suffix,
    format_group_header,
    format_value,
    group_by_resource_type,
    is_field_changes,
)
from dagshund.merge import merge_sub_resources
from dagshund.plan import (
    action_to_diff_state,
    detect_changes,
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
    parse_resource_key,
)

_BLOCK_INDENT = 10  # 6 (field indent) + 4 (content offset for wrapped continuation lines)

# Minimum terminal width for smart wrapping. Below this, let the terminal handle wrapping.
# Unrelated to format._INLINE_LIMIT (which controls inline-vs-block for collection values).
_MIN_WRAP_WIDTH = 60

# ANSI color codes
RESET = "\033[0m"
_BOLD = "\033[1m"
DIM = "\033[2m"
GREEN = "\033[32m"
RED = "\033[31m"
YELLOW = "\033[33m"
_CYAN = "\033[36m"

# Maps action display name to ANSI color
_DISPLAY_COLORS: dict[str, str] = {
    "create": GREEN,
    "delete": RED,
    "update": YELLOW,
    "recreate": YELLOW,
    "resize": YELLOW,
    "update_id": YELLOW,
    "unchanged": DIM,
    "unknown": RESET,
}


def _action_color(cfg: ActionConfig) -> str:
    """Look up the ANSI color for an action config."""
    return _DISPLAY_COLORS.get(cfg.display, RESET)


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


def _detect_terminal_width() -> int:
    """Detect the terminal width in columns, falling back to 80 when not connected to a tty."""
    try:
        return os.get_terminal_size().columns
    except (ValueError, OSError):
        return 80


def _wrap_transition(prefix: str, change: FieldChange) -> str | None:
    """Build a two-line wrapped transition from the change dict, breaking at ->.

    Returns None if the change is not a wrappable transition (single value, no-op, etc.).
    Uses format_display_value/format_value directly — no string parsing.
    """
    old, new = change.get("old"), change.get("new")
    has_old, has_new = "old" in change, "new" in change

    if not has_old or not has_new:
        return None

    remote = change.get("remote")

    # Drift: old == new but remote differs — show remote -> new (drift)
    # Uses format_value (no truncation) to match format_field_suffix drift path
    if old == new and "remote" in change and remote != old:
        left = format_value(remote)
        right = format_value(new)
        first = f"{prefix}: {left}"
        cont = f"{' ' * _BLOCK_INDENT}-> {right} (drift)"
        return f"{first}\n{cont}"

    # No-op: old == new — nothing to wrap
    if old == new:
        return None

    # Normal transition: old -> new
    left = format_display_value(old)
    right = format_display_value(new)
    first = f"{prefix}: {left}"
    cont = f"{' ' * _BLOCK_INDENT}-> {right}"
    return f"{first}\n{cont}"


def _wrap_warning_line(line: str, width: int) -> str:
    """Wrap a warning line to fit within width, with 4-space continuation indent."""
    if len(line) <= width:
        return line
    return textwrap.fill(line, width=width, subsequent_indent="    ")


def _render_field_change(
    field_name: str, change: FieldChange, *, use_color: bool, width: int | None = None
) -> str | None:
    """Render a single field-level change, or None if unchanged/no-op."""
    action = str(change.get("action", ""))
    if action_to_diff_state(action) == DiffState.UNCHANGED:
        return None

    suffix = format_field_suffix(change)
    if suffix is None:
        return None

    field_config = action_config(action)
    prefix = f"      {field_config.symbol} {field_name}"
    line = f"{prefix}{suffix}"

    if width is not None and width >= _MIN_WRAP_WIDTH and len(line) > width and "\n" not in suffix:
        wrapped = _wrap_transition(prefix, change)
        if wrapped is not None:
            line = wrapped

    return _colorize(line, _action_color(field_config), use_color=use_color)


def _render_resource(
    key: ResourceKey,
    entry: ResourceChange,
    *,
    use_color: bool,
    width: int | None = None,
) -> Iterator[str]:
    """Render a single resource entry as lines of text."""
    action = entry.get("action", "")
    cfg = action_config(action)
    resource_type, resource_name = parse_resource_key(key)

    label = f"  ({cfg.display})" if action_to_diff_state(action) != DiffState.UNCHANGED else ""
    header = f"  {cfg.symbol} {resource_type}/{resource_name}{label}"
    yield _colorize(header, _action_color(cfg), use_color=use_color)

    changes = entry.get("changes", {})
    if is_field_changes(changes) and cfg.show_field_changes and detect_drift_fields(changes):
        yield _colorize("      \u26a0 manually edited outside bundle", YELLOW, use_color=use_color)

    if is_field_changes(changes) and changes and cfg.show_field_changes:
        for field_name, change in sorted(changes.items()):
            if not isinstance(change, dict):
                continue
            rendered = _render_field_change(field_name, change, use_color=use_color, width=width)
            if rendered is not None:
                yield rendered


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


def _print_resource_groups(
    resource_groups: ResourceChangesByType,
    *,
    use_color: bool,
    visible_states: frozenset[DiffState] | None = None,
    resource_filter: Callable[[ResourceKey, ResourceChange], bool] | None = None,
    width: int | None = None,
) -> None:
    """Print each resource type group with its entries."""
    for resource_type, entries in resource_groups.items():  # already sorted by group_by_resource_type
        visible = filter_resources(entries, visible_states=visible_states, resource_filter=resource_filter)
        if not visible:
            continue

        header = f"  {format_group_header(resource_type, len(entries), len(visible))}"
        print(_colorize(header, _CYAN + _BOLD, use_color=use_color))
        for key, entry in sorted(visible.items()):
            for line in _render_resource(key, entry, use_color=use_color, width=width):
                print(line)
        print()


def _format_action_count(cfg: ActionConfig, count: int, *, use_color: bool) -> str:
    """Format a single action count like '+3 create' with color."""
    return _colorize(f"{cfg.symbol}{count} {cfg.display}", _action_color(cfg), use_color=use_color)


def _print_summary(
    resources: ResourceChanges,
    *,
    use_color: bool,
    visible_states: frozenset[DiffState] | None = None,
    resource_filter: Callable[[ResourceKey, ResourceChange], bool] | None = None,
) -> None:
    """Print the action count summary line, filtered to visible states when provided."""
    filtered = filter_resources(resources, visible_states=visible_states, resource_filter=resource_filter)
    sorted_counts = sorted(count_by_action(filtered).items(), key=lambda item: item[0].display)
    parts = ", ".join(_format_action_count(cfg, count, use_color=use_color) for cfg, count in sorted_counts)
    if parts:
        print(f"  {parts}")


def _print_warnings(warnings: list[str], *, use_color: bool, width: int | None = None) -> None:
    """Print data-loss warnings below the summary line."""
    print()
    print(_colorize("  Dangerous Actions:", RED + _BOLD, use_color=use_color))
    for warning in warnings:
        line = f"  \u26a0 {warning}"
        if width is not None and width >= _MIN_WRAP_WIDTH:
            line = _wrap_warning_line(line, width)
        print(_colorize(line, RED, use_color=use_color))


def _print_drift_warnings(warnings: list[str], *, use_color: bool, width: int | None = None) -> None:
    """Print drift warnings below the summary line."""
    print()
    print(_colorize("  Manual Edits Detected:", YELLOW + _BOLD, use_color=use_color))
    for warning in warnings:
        line = f"  \u26a0 {warning}"
        if width is not None and width >= _MIN_WRAP_WIDTH:
            line = _wrap_warning_line(line, width)
        print(_colorize(line, YELLOW, use_color=use_color))


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
    width = _detect_terminal_width()
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
        group_by_resource_type(resources),
        use_color=use_color,
        visible_states=visible_states,
        resource_filter=resource_filter,
        width=width,
    )
    _print_summary(resources, use_color=use_color, visible_states=visible_states, resource_filter=resource_filter)

    warnings = collect_warnings(resources, visible_states=visible_states, resource_filter=resource_filter)
    if warnings:
        _print_warnings(warnings, use_color=use_color, width=width)

    drift_warnings = collect_drift_warnings(resources, visible_states=visible_states, resource_filter=resource_filter)
    if drift_warnings:
        _print_drift_warnings(drift_warnings, use_color=use_color, width=width)
