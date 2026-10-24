import re
from collections.abc import Iterator, Mapping, Sequence

from dagshund.change_path import FieldChangeContext
from dagshund.format import (
    DriftSummary,
    Report,
    ResourceGroup,
    action_config,
    field_action_config,
    format_field_suffix,
    format_wheel_update_body,
    iter_drift_subline_bodies,
    iter_effect_field_changes,
    prepare_report,
    select_resource_details,
    select_standalone_job_run_effect,
)
from dagshund.job_run_effects import classify_job_run_effect
from dagshund.model import ActionType, FieldChange, JobRunEffect, ResourceChange
from dagshund.plan import (
    action_to_diff_state,
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

_MARKDOWN_PUNCTUATION = re.compile(r"([`*_{}\[\]()#+!|~])")


def _escape_plain_text(value: str) -> str:
    escaped = []
    for character in value:
        codepoint = ord(character)
        if character == "\\":
            escaped.append("\\\\")
        elif character == "\n":
            escaped.append("\\n")
        elif character == "\r":
            escaped.append("\\r")
        elif character == "\t":
            escaped.append("\\t")
        elif codepoint < 32 or 0x7F <= codepoint <= 0x9F or codepoint in (0x2028, 0x2029):
            escaped.append(f"\\u{codepoint:04x}")
        else:
            escaped.append(character)
    text = _MARKDOWN_PUNCTUATION.sub(r"\\\1", "".join(escaped))
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _code_span(value: str) -> str:
    value = _escape_controls(value)
    runs = [len(run) for run in re.findall(r"`+", value)]
    delimiter = "`" * (max(runs, default=0) + 1)
    padding = " " if value.startswith(("`", " ")) or value.endswith(("`", " ")) else ""
    return f"{delimiter}{padding}{value}{padding}{delimiter}"


def _escape_controls(value: str) -> str:
    return "".join(
        character
        if ord(character) >= 32 and not 0x7F <= ord(character) <= 0x9F and ord(character) not in (0x2028, 0x2029)
        else {"\\n": "\\n", "\\r": "\\r", "\\t": "\\t"}.get(character, f"\\u{ord(character):04x}")
        for character in value
    )


def _render_field_change(
    field_name: str,
    change: FieldChange,
    *,
    ctx: FieldChangeContext | None = None,
) -> str | None:
    if action_to_diff_state(change.action) == DiffState.UNCHANGED:
        return None

    suffix = format_field_suffix(change, ctx)
    if suffix is None:
        return None

    cfg = field_action_config(change, ctx)
    return f"  - `{cfg.symbol}` {_code_span(field_name)}{_escape_plain_text(suffix)}"


def _render_synced_table_output(output: SyncedTableOutput, owner_action: ActionType) -> str:
    action = owner_action if output.relationship == OutputRelationship.MANAGED else ActionType.EMPTY
    cfg = action_config(action)
    relationship = _escape_plain_text(str(output.relationship))
    return f"  - `{cfg.symbol}` {relationship} {output.resource_type}: {_code_span(output.name)}"


def _render_effect_lines(effect: JobRunEffect, *, standalone: bool = False) -> Iterator[str]:
    """Render shared semantic details for attached or standalone runs."""
    semantics = classify_job_run_effect(effect)
    cfg = action_config(effect.action)
    label = _code_span(effect.name)
    name = f"[{label}]({effect.run_page_url})" if effect.run_page_url else label
    if standalone:
        resource_name = _code_span(f"job_runs/{effect.name}")
        resource_link = f"[{resource_name}]({effect.run_page_url})" if effect.run_page_url else resource_name
        yield f"- `{cfg.symbol}` {resource_link} — {_escape_plain_text(semantics.wording)}"
        detail_indent = "  "
    else:
        yield f"  - `{cfg.symbol}` run {name} ({_escape_plain_text(semantics.wording)})"
        detail_indent = "    "
    if semantics.state_message is not None:
        yield f"{detail_indent}- state: {_escape_plain_text(semantics.state_message)}"
    for field_name, change, ctx in iter_effect_field_changes(effect):
        rendered = _render_field_change(field_name, change, ctx=ctx)
        if rendered is not None:
            yield f"{'  ' if not standalone else ''}{rendered}"


def _render_resource(
    key: ResourceKey,
    entry: ResourceChange,
    *,
    suppress_wheel_updates: bool = False,
) -> Iterator[str]:
    standalone_run = select_standalone_job_run_effect(key, entry)
    if standalone_run is not None:
        yield from _render_effect_lines(standalone_run, standalone=True)
        return

    cfg = action_config(entry.action)
    resource_type, resource_name = parse_resource_key(key)

    label = f" \u2014 {cfg.display}" if action_to_diff_state(entry.action) != DiffState.UNCHANGED else ""
    yield f"- `{cfg.symbol}` {_code_span(f'{resource_type}/{resource_name}')}{label}"

    for output in extract_synced_table_outputs(key, entry):
        yield _render_synced_table_output(output, entry.action)

    # Effects remain visible even when the parent has no field details.
    for effect in entry.effects:
        yield from _render_effect_lines(effect)

    details = select_resource_details(entry, suppress_wheel_updates=suppress_wheel_updates)
    if details.has_drift:
        yield "  - :warning: manually edited outside bundle"

    for field_name, change, ctx in details.fields:
        rendered = _render_field_change(field_name, change, ctx=ctx)
        if rendered is not None:
            yield rendered

    for usage in details.wheel_updates:
        yield f"  - `~` {_escape_plain_text(format_wheel_update_body(usage))}"

    if details.topology_readds:
        create_cfg = action_config(ActionType.CREATE)
        for key_name in details.topology_readds:
            yield f"  - `{create_cfg.symbol}` {_code_span(key_name)} (drift) (re-added)"


def _render_header(*, cli_version: str | None, plan_version: int | None) -> Iterator[str]:
    displayed_cli_version = cli_version or "unknown"
    displayed_plan_version = plan_version if plan_version is not None else "?"
    yield f"### dagshund plan (v{displayed_plan_version}, cli {_escape_plain_text(displayed_cli_version)})"
    yield ""


def _render_resource_groups(
    resource_groups: Sequence[ResourceGroup],
    *,
    suppress_wheel_updates: bool = False,
) -> Iterator[str]:
    for group in resource_groups:
        count = f"({len(group.entries)}/{group.total})" if len(group.entries) != group.total else f"({group.total})"
        yield f"#### {_escape_plain_text(group.resource_type)} {count}"
        for key, entry in group.entries:
            yield from _render_resource(key, entry, suppress_wheel_updates=suppress_wheel_updates)
        yield ""


def _render_summary(report: Report) -> Iterator[str]:
    parts = ", ".join(f"**{cfg.symbol}{count}** {cfg.display}" for cfg, count in report.action_counts)
    if parts:
        yield parts

    effect_parts = ", ".join(f"**{cfg.symbol}{count}** {cfg.display}" for cfg, count in report.effect_counts)
    if effect_parts:
        yield ""
        yield f"runs: {effect_parts}"


def _render_warnings(warnings: Sequence[str]) -> Iterator[str]:
    yield ""
    yield "> [!CAUTION]"
    yield "> **Dangerous Actions**"
    for warning in warnings:
        yield f"> - {_escape_plain_text(warning)}"


def _iter_drift_warning_md_lines(summary: DriftSummary) -> Iterator[str]:
    """Yield the header + nested sub-bullets for a single drift summary.

    The ``>   - `` prefix (three spaces between ``>`` and ``-``) is required for
    GitHub/GitLab nested bullet rendering inside alert blocks; top-level bullets
    use ``> -`` (one space).
    """
    resource_type = _escape_plain_text(summary.resource_type)
    resource_name = _escape_plain_text(summary.resource_name)
    yield f"> - {resource_type}/{resource_name} was edited outside the bundle"
    for body in iter_drift_subline_bodies(summary):
        yield f">   - {_escape_plain_text(body)}"


def _render_drift_warnings(summaries: Sequence[DriftSummary]) -> Iterator[str]:
    yield ""
    yield "> [!WARNING]"
    yield "> **Manual Edits Detected**"
    for summary in summaries:
        yield from _iter_drift_warning_md_lines(summary)


def render_markdown(
    resources: Mapping[ResourceKey, ResourceChange],
    *,
    cli_version: str | None = None,
    plan_version: int | None = None,
    visible_states: frozenset[DiffState] | None = None,
    filter_query: str | None = None,
    suppress_wheel_updates: bool = False,
) -> str:
    """Format normalized resources; callers must apply ``normalize_plan`` first.

    Version metadata is optional and does not require a parsed plan envelope.
    The renderer only reads borrowed resources; callers must not mutate them while rendering.
    """
    report = prepare_report(resources, visible_states=visible_states, filter_query=filter_query)

    lines: list[str] = []
    lines.extend(_render_header(cli_version=cli_version, plan_version=plan_version))

    if report.no_changes:
        lines.append(f"No changes ({len(resources)} resources unchanged)")
        return "\n".join(lines)

    lines.extend(
        _render_resource_groups(
            report.groups,
            suppress_wheel_updates=suppress_wheel_updates,
        )
    )
    lines.extend(_render_summary(report))

    if report.warnings:
        lines.extend(_render_warnings(report.warnings))

    if report.drift_summaries:
        lines.extend(_render_drift_warnings(report.drift_summaries))

    return "\n".join(lines)
