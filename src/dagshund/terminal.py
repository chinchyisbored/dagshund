import os
import sys
import textwrap
from collections.abc import Callable, Iterator, Mapping
from dataclasses import replace
from itertools import groupby

from dagshund.change_path import FieldChangeContext
from dagshund.format import (
    ActionConfig,
    DriftSummary,
    action_config,
    collect_drift_summaries,
    collect_warnings,
    count_by_action,
    detect_drift_fields,
    detect_drift_reentries,
    field_action_config,
    filter_resources,
    format_display_value,
    format_drift_subline_body,
    format_field_suffix,
    format_group_header,
    format_value,
    group_by_resource_type,
    iter_non_topology_field_changes,
)
from dagshund.merge import merge_sub_resources
from dagshund.model import UNSET, ActionType, FieldChange, Plan, ResourceChange
from dagshund.plan import (
    action_to_diff_state,
    detect_changes,
    is_topology_drift_change,
    resource_has_shape_drift,
)
from dagshund.types import (
    DagshundError,
    DiffState,
    ResourceKey,
    parse_resource_key,
)

_BLOCK_INDENT = 10  # 6 (field indent) + 4 (content offset for wrapped continuation lines)

# Minimum terminal width for smart wrapping. Below this, let the terminal handle wrapping.
# Unrelated to format._INLINE_LIMIT (which controls inline-vs-block for collection values).
_MIN_WRAP_WIDTH = 60

RESET = "\033[0m"
_BOLD = "\033[1m"
DIM = "\033[2m"
GREEN = "\033[32m"
RED = "\033[31m"
YELLOW = "\033[33m"
_CYAN = "\033[36m"

_DISPLAY_COLORS: dict[str, str] = {
    "create": GREEN,
    "delete": RED,
    "update": YELLOW,
    "recreate": YELLOW,
    "resize": YELLOW,
    "update_id": YELLOW,
    "remote": DIM,
    "unchanged": DIM,
    "unknown": RESET,
}


def _action_color(cfg: ActionConfig) -> str:
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
    try:
        return os.get_terminal_size().columns
    except (ValueError, OSError):
        return 80


def _wrap_transition(prefix: str, change: FieldChange) -> str | None:
    if change.old is UNSET or change.new is UNSET:
        return None

    # Drift: old == new but remote differs — show remote -> new (drift)
    # Uses format_value (no truncation) to match format_field_suffix drift path
    if change.old == change.new and change.remote is not UNSET and change.remote != change.old:
        left = format_value(change.remote)
        right = format_value(change.new)
        first = f"{prefix}: {left}"
        cont = f"{' ' * _BLOCK_INDENT}-> {right} (drift)"
        return f"{first}\n{cont}"

    if change.old == change.new:
        return None

    left = format_display_value(change.old)
    right = format_display_value(change.new)
    first = f"{prefix}: {left}"
    cont = f"{' ' * _BLOCK_INDENT}-> {right}"
    return f"{first}\n{cont}"


def _wrap_warning_line(line: str, width: int) -> str:
    if len(line) <= width:
        return line
    return textwrap.fill(line, width=width, subsequent_indent="    ")


def _render_field_change(
    field_name: str,
    change: FieldChange,
    *,
    ctx: FieldChangeContext | None = None,
    use_color: bool,
    width: int | None = None,
) -> str | None:
    if action_to_diff_state(change.action) == DiffState.UNCHANGED:
        return None

    suffix = format_field_suffix(change, ctx)
    if suffix is None:
        return None

    field_config = field_action_config(change, ctx)
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
    cfg = action_config(entry.action)
    resource_type, resource_name = parse_resource_key(key)

    label = f"  ({cfg.display})" if action_to_diff_state(entry.action) != DiffState.UNCHANGED else ""
    header = f"  {cfg.symbol} {resource_type}/{resource_name}{label}"
    yield _colorize(header, _action_color(cfg), use_color=use_color)

    changes = entry.changes
    if not (changes and cfg.show_field_changes):
        return

    reentries = detect_drift_reentries(changes)
    shape_drift = resource_has_shape_drift(entry)
    drift_fields = detect_drift_fields(
        changes,
        new_state=entry.new_state,
        remote_state=entry.remote_state,
        shape_drift=shape_drift,
    )
    if drift_fields or reentries:
        yield _colorize("      \u26a0 manually edited outside bundle", YELLOW, use_color=use_color)

    for field_name, change, ctx in iter_non_topology_field_changes(
        changes,
        new_state=entry.new_state,
        remote_state=entry.remote_state,
        shape_drift=shape_drift,
    ):
        rendered = _render_field_change(field_name, change, ctx=ctx, use_color=use_color, width=width)
        if rendered is not None:
            yield rendered

    if reentries:
        create_cfg = action_config(ActionType.CREATE)
        create_color = _action_color(create_cfg)
        for key_name, change in sorted(changes.items()):
            if not is_topology_drift_change(change):
                continue
            line = f"      {create_cfg.symbol} {key_name} (drift) (re-added)"
            yield _colorize(line, create_color, use_color=use_color)


def _print_header(plan: Plan, *, use_color: bool) -> None:
    cli_version = plan.cli_version or "unknown"
    plan_version = plan.plan_version if plan.plan_version is not None else "?"
    print(
        _colorize(
            f"dagshund plan (v{plan_version}, cli {cli_version})",
            _BOLD,
            use_color=use_color,
        )
    )
    print()


def _print_resource_groups(
    resource_groups: Mapping[str, Mapping[ResourceKey, ResourceChange]],
    *,
    use_color: bool,
    visible_states: frozenset[DiffState] | None = None,
    resource_filter: Callable[[ResourceKey, ResourceChange], bool] | None = None,
    width: int | None = None,
) -> None:
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
    return _colorize(f"{cfg.symbol}{count} {cfg.display}", _action_color(cfg), use_color=use_color)


def _print_summary(
    resources: Mapping[ResourceKey, ResourceChange],
    *,
    use_color: bool,
    visible_states: frozenset[DiffState] | None = None,
    resource_filter: Callable[[ResourceKey, ResourceChange], bool] | None = None,
) -> None:
    filtered = filter_resources(resources, visible_states=visible_states, resource_filter=resource_filter)
    sorted_counts = sorted(count_by_action(filtered).items(), key=lambda item: item[0].display)
    parts = ", ".join(_format_action_count(cfg, count, use_color=use_color) for cfg, count in sorted_counts)
    if parts:
        print(f"  {parts}")


def _print_warnings(warnings: list[str], *, use_color: bool, width: int | None = None) -> None:
    print()
    print(_colorize("  Dangerous Actions:", RED + _BOLD, use_color=use_color))
    for warning in warnings:
        line = f"  \u26a0 {warning}"
        if width is not None and width >= _MIN_WRAP_WIDTH:
            line = _wrap_warning_line(line, width)
        print(_colorize(line, RED, use_color=use_color))


def _iter_drift_warning_lines(summary: DriftSummary) -> Iterator[str]:
    yield f"  \u26a0 {summary.resource_type}/{summary.resource_name} was edited outside the bundle"
    if summary.overwritten_field_count > 0:
        yield f"      {format_drift_subline_body(summary.overwritten_field_count, 'field', 'overwritten')}"
    # reentries are pre-sorted by (noun, label); groupby is correct without re-sorting.
    for noun, group in groupby(summary.reentries, key=lambda pair: pair[0]):
        labels = [pair[1] for pair in group]
        yield f"      {format_drift_subline_body(len(labels), noun, 're-added', ', '.join(labels))}"


def _print_drift_warnings(summaries: list[DriftSummary], *, use_color: bool, width: int | None = None) -> None:
    print()
    print(_colorize("  Manual Edits Detected:", YELLOW + _BOLD, use_color=use_color))
    for summary in summaries:
        for line in _iter_drift_warning_lines(summary):
            if width is not None and width >= _MIN_WRAP_WIDTH and line.startswith("  \u26a0"):
                line = _wrap_warning_line(line, width)
            print(_colorize(line, YELLOW, use_color=use_color))


def render_text(
    plan: Plan,
    *,
    visible_states: frozenset[DiffState] | None = None,
    filter_query: str | None = None,
) -> None:
    resources = merge_sub_resources(plan.resources)
    if not resources:
        raise DagshundError("plan is empty")
    plan = replace(plan, resources=resources)

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

    drift_summaries = collect_drift_summaries(resources, visible_states=visible_states, resource_filter=resource_filter)
    if drift_summaries:
        _print_drift_warnings(drift_summaries, use_color=use_color, width=width)
