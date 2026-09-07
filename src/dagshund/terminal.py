import os
import sys
import textwrap
from collections.abc import Iterator, Mapping, Sequence
from typing import cast

from dagshund.change_path import FieldChangeContext
from dagshund.format import (
    ActionConfig,
    DriftSummary,
    Report,
    ResourceGroup,
    action_config,
    field_action_config,
    format_display_value,
    format_field_suffix,
    format_group_header,
    format_value,
    format_wheel_update_body,
    iter_drift_subline_bodies,
    iter_effect_field_changes,
    prepare_report,
    select_resource_details,
)
from dagshund.job_run_effects import classify_job_run_effect
from dagshund.model import UNSET, ActionType, FieldChange, JobRunEffect, ResourceChange
from dagshund.plan import (
    action_to_diff_state,
    has_drifted_field,
)
from dagshund.synced_table_outputs import (
    OutputRelationship,
    SyncedTableOutput,
    extract_synced_table_outputs,
)
from dagshund.types import (
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
    return cast("bool", sys.stdout.isatty())


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
    if has_drifted_field(change):
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


def _wrap_warning_line(line: str, width: int, *, subsequent_indent: str = "    ") -> str:
    if len(line) <= width:
        return line
    return textwrap.fill(line, width=width, subsequent_indent=subsequent_indent)


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


# Effect field changes render one level deeper than the effect line; the wrap
# width narrows by the same amount so re-indented lines still fit the terminal.
_EFFECT_LINE_INDENT = 6
_EFFECT_FIELD_EXTRA_INDENT = 4


def _render_synced_table_output(
    output: SyncedTableOutput,
    owner_action: ActionType,
    *,
    use_color: bool,
) -> str:
    action = owner_action if output.relationship == OutputRelationship.MANAGED else ActionType.EMPTY
    cfg = action_config(action)
    line = f"      {cfg.symbol} {output.relationship} {output.resource_type}: {output.name}"
    return _colorize(line, _action_color(cfg), use_color=use_color)


def _render_effect_lines(
    effect: JobRunEffect,
    *,
    use_color: bool,
    width: int | None = None,
) -> Iterator[str]:
    """Trailing per-job lines for a deploy-triggered run, one per effect."""
    semantics = classify_job_run_effect(effect)
    cfg = action_config(effect.action)
    line = f"{' ' * _EFFECT_LINE_INDENT}{cfg.symbol} run {effect.name} ({semantics.wording})"
    yield _colorize(line, _action_color(cfg), use_color=use_color)

    state_indent = " " * (_EFFECT_LINE_INDENT + _EFFECT_FIELD_EXTRA_INDENT)
    field_indent = " " * _EFFECT_FIELD_EXTRA_INDENT
    if semantics.state_message is not None:
        state_line = f"{state_indent}state: {semantics.state_message}"
        if width is not None and width >= _MIN_WRAP_WIDTH:
            state_line = _wrap_warning_line(state_line, width, subsequent_indent=state_indent)
        yield _colorize(state_line, DIM, use_color=use_color)

    narrowed = width - _EFFECT_FIELD_EXTRA_INDENT if width is not None else None
    for field_name, change, ctx in iter_effect_field_changes(effect):
        rendered = _render_field_change(field_name, change, ctx=ctx, use_color=use_color, width=narrowed)
        if rendered is not None:
            yield "\n".join(f"{field_indent}{part}" for part in rendered.split("\n"))


def _render_resource(
    key: ResourceKey,
    entry: ResourceChange,
    *,
    use_color: bool,
    width: int | None = None,
    suppress_wheel_updates: bool = False,
) -> Iterator[str]:
    cfg = action_config(entry.action)
    resource_type, resource_name = parse_resource_key(key)

    label = f"  ({cfg.display})" if action_to_diff_state(entry.action) != DiffState.UNCHANGED else ""
    header = f"  {cfg.symbol} {resource_type}/{resource_name}{label}"
    yield _colorize(header, _action_color(cfg), use_color=use_color)

    for output in extract_synced_table_outputs(key, entry):
        yield _render_synced_table_output(output, entry.action, use_color=use_color)

    # Effects remain visible even when the parent has no field details.
    for effect in entry.effects:
        yield from _render_effect_lines(effect, use_color=use_color, width=width)

    details = select_resource_details(entry, suppress_wheel_updates=suppress_wheel_updates)
    if details.has_drift:
        yield _colorize("      \u26a0 manually edited outside bundle", YELLOW, use_color=use_color)

    for field_name, change, ctx in details.fields:
        rendered = _render_field_change(field_name, change, ctx=ctx, use_color=use_color, width=width)
        if rendered is not None:
            yield rendered

    for usage in details.wheel_updates:
        line = f"      ~ {format_wheel_update_body(usage)}"
        yield _colorize(line, YELLOW, use_color=use_color)

    if details.topology_readds:
        create_cfg = action_config(ActionType.CREATE)
        create_color = _action_color(create_cfg)
        for key_name in details.topology_readds:
            line = f"      {create_cfg.symbol} {key_name} (drift) (re-added)"
            yield _colorize(line, create_color, use_color=use_color)


def _print_header(*, cli_version: str | None, plan_version: int | None, use_color: bool) -> None:
    displayed_cli_version = cli_version or "unknown"
    displayed_plan_version = plan_version if plan_version is not None else "?"
    print(
        _colorize(
            f"dagshund plan (v{displayed_plan_version}, cli {displayed_cli_version})",
            _BOLD,
            use_color=use_color,
        )
    )
    print()


def _print_resource_groups(
    resource_groups: Sequence[ResourceGroup],
    *,
    use_color: bool,
    width: int | None = None,
    suppress_wheel_updates: bool = False,
) -> None:
    for group in resource_groups:
        header = f"  {format_group_header(group.resource_type, group.total, len(group.entries))}"
        print(_colorize(header, _CYAN + _BOLD, use_color=use_color))
        for key, entry in group.entries:
            for line in _render_resource(
                key,
                entry,
                use_color=use_color,
                width=width,
                suppress_wheel_updates=suppress_wheel_updates,
            ):
                print(line)
        print()


def _format_action_count(cfg: ActionConfig, count: int, *, use_color: bool) -> str:
    return _colorize(f"{cfg.symbol}{count} {cfg.display}", _action_color(cfg), use_color=use_color)


def _print_summary(report: Report, *, use_color: bool) -> None:
    parts = ", ".join(_format_action_count(cfg, count, use_color=use_color) for cfg, count in report.action_counts)
    if parts:
        print(f"  {parts}")

    effect_parts = ", ".join(
        _format_action_count(cfg, count, use_color=use_color) for cfg, count in report.effect_counts
    )
    if effect_parts:
        print(f"  runs: {effect_parts}")


def _print_warnings(warnings: Sequence[str], *, use_color: bool, width: int | None = None) -> None:
    print()
    print(_colorize("  Dangerous Actions:", RED + _BOLD, use_color=use_color))
    for warning in warnings:
        line = f"  \u26a0 {warning}"
        if width is not None and width >= _MIN_WRAP_WIDTH:
            line = _wrap_warning_line(line, width)
        print(_colorize(line, RED, use_color=use_color))


def _iter_drift_warning_lines(summary: DriftSummary) -> Iterator[str]:
    yield f"  \u26a0 {summary.resource_type}/{summary.resource_name} was edited outside the bundle"
    for body in iter_drift_subline_bodies(summary):
        yield f"      {body}"


def _print_drift_warnings(summaries: Sequence[DriftSummary], *, use_color: bool, width: int | None = None) -> None:
    print()
    print(_colorize("  Manual Edits Detected:", YELLOW + _BOLD, use_color=use_color))
    for summary in summaries:
        for line in _iter_drift_warning_lines(summary):
            if width is not None and width >= _MIN_WRAP_WIDTH and line.startswith("  \u26a0"):
                line = _wrap_warning_line(line, width)
            print(_colorize(line, YELLOW, use_color=use_color))


def render_text(
    resources: Mapping[ResourceKey, ResourceChange],
    *,
    cli_version: str | None = None,
    plan_version: int | None = None,
    visible_states: frozenset[DiffState] | None = None,
    filter_query: str | None = None,
    suppress_wheel_updates: bool = False,
) -> None:
    """Print normalized resources; callers must apply ``normalize_plan`` first.

    Version metadata is optional and does not require a parsed plan envelope.
    """
    report = prepare_report(resources, visible_states=visible_states, filter_query=filter_query)

    use_color = _supports_color()
    width = _detect_terminal_width()
    _print_header(cli_version=cli_version, plan_version=plan_version, use_color=use_color)

    if report.no_changes:
        print(
            _colorize(
                f"  No changes ({len(resources)} resources unchanged)",
                DIM,
                use_color=use_color,
            )
        )
        return

    _print_resource_groups(
        report.groups,
        use_color=use_color,
        width=width,
        suppress_wheel_updates=suppress_wheel_updates,
    )
    _print_summary(report, use_color=use_color)

    if report.warnings:
        _print_warnings(report.warnings, use_color=use_color, width=width)

    if report.drift_summaries:
        _print_drift_warnings(report.drift_summaries, use_color=use_color, width=width)
