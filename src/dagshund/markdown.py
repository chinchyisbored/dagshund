"""Markdown rendering of plan diffs for PR/MR comments."""

from collections.abc import Callable, Iterator, Mapping
from dataclasses import replace
from itertools import groupby

from dagshund.format import (
    DriftSummary,
    action_config,
    collect_drift_summaries,
    collect_warnings,
    count_by_action,
    detect_drift_fields,
    detect_drift_reentries,
    field_action_config,
    filter_resources,
    format_drift_subline_body,
    format_field_suffix,
    format_group_header,
    group_by_resource_type,
    iter_non_topology_field_changes,
)
from dagshund.merge import merge_sub_resources
from dagshund.model import ActionType, FieldChange, Plan, ResourceChange
from dagshund.plan import (
    action_to_diff_state,
    detect_changes,
    is_topology_drift_change,
)
from dagshund.types import (
    DagshundError,
    DiffState,
    ResourceKey,
    parse_resource_key,
)


def _render_field_change(field_name: str, change: FieldChange) -> str | None:
    """Render a single field-level change as a markdown list item, or None if unchanged/no-op."""
    if action_to_diff_state(change.action) == DiffState.UNCHANGED:
        return None

    suffix = format_field_suffix(change)
    if suffix is None:
        return None

    cfg = field_action_config(change)
    return f"  - `{cfg.symbol}` `{field_name}`{suffix}"


def _render_resource(
    key: ResourceKey,
    entry: ResourceChange,
) -> Iterator[str]:
    """Render a single resource entry as markdown list items."""
    cfg = action_config(entry.action)
    resource_type, resource_name = parse_resource_key(key)

    label = f" \u2014 {cfg.display}" if action_to_diff_state(entry.action) != DiffState.UNCHANGED else ""
    yield f"- `{cfg.symbol}` `{resource_type}/{resource_name}`{label}"

    changes = entry.changes
    if not (changes and cfg.show_field_changes):
        return

    reentries = detect_drift_reentries(changes)
    if detect_drift_fields(changes) or reentries:
        yield "  - :warning: manually edited outside bundle"

    for field_name, change in iter_non_topology_field_changes(changes):
        rendered = _render_field_change(field_name, change)
        if rendered is not None:
            yield rendered

    if reentries:
        create_cfg = action_config(ActionType.CREATE)
        for key_name, change in sorted(changes.items()):
            if not is_topology_drift_change(change):
                continue
            yield f"  - `{create_cfg.symbol}` `{key_name}` (re-added)"


def _render_header(plan: Plan) -> Iterator[str]:
    """Render the plan version header."""
    cli_version = plan.cli_version or "unknown"
    plan_version = plan.plan_version if plan.plan_version is not None else "?"
    yield f"### dagshund plan (v{plan_version}, cli {cli_version})"
    yield ""


def _render_resource_groups(
    resource_groups: Mapping[str, Mapping[ResourceKey, ResourceChange]],
    *,
    visible_states: frozenset[DiffState] | None = None,
    resource_filter: Callable[[ResourceKey, ResourceChange], bool] | None = None,
) -> Iterator[str]:
    """Render each resource type group with its entries."""
    for resource_type, entries in resource_groups.items():
        visible = filter_resources(entries, visible_states=visible_states, resource_filter=resource_filter)
        if not visible:
            continue

        yield f"#### {format_group_header(resource_type, len(entries), len(visible))}"
        for key, entry in sorted(visible.items()):
            yield from _render_resource(key, entry)
        yield ""


def _render_summary(
    resources: Mapping[ResourceKey, ResourceChange],
    *,
    visible_states: frozenset[DiffState] | None = None,
    resource_filter: Callable[[ResourceKey, ResourceChange], bool] | None = None,
) -> Iterator[str]:
    """Render the action count summary line."""
    filtered = filter_resources(resources, visible_states=visible_states, resource_filter=resource_filter)
    sorted_counts = sorted(count_by_action(filtered).items(), key=lambda item: item[0].display)
    parts = ", ".join(f"**{cfg.symbol}{count}** {cfg.display}" for cfg, count in sorted_counts)
    if parts:
        yield parts


def _render_warnings(warnings: list[str]) -> Iterator[str]:
    """Render data-loss warnings as a GitHub/GitLab alert block."""
    yield ""
    yield "> [!CAUTION]"
    yield "> **Dangerous Actions**"
    for warning in warnings:
        yield f"> - {warning}"


def _iter_drift_warning_md_lines(summary: DriftSummary) -> Iterator[str]:
    """Yield the header + nested sub-bullets for a single drift summary.

    The ``>   - `` prefix (three spaces between ``>`` and ``-``) is required for
    GitHub/GitLab nested bullet rendering inside alert blocks; top-level bullets
    use ``> -`` (one space).
    """
    yield f"> - {summary.resource_type}/{summary.resource_name} was edited outside the bundle"
    if summary.overwritten_field_count > 0:
        yield f">   - {format_drift_subline_body(summary.overwritten_field_count, 'field', 'overwritten')}"
    for noun, group in groupby(summary.reentries, key=lambda pair: pair[0]):
        labels = [pair[1] for pair in group]
        yield f">   - {format_drift_subline_body(len(labels), noun, 're-added', ', '.join(labels))}"


def _render_drift_warnings(summaries: list[DriftSummary]) -> Iterator[str]:
    """Render drift warnings as a GitHub/GitLab alert block."""
    yield ""
    yield "> [!WARNING]"
    yield "> **Manual Edits Detected**"
    for summary in summaries:
        yield from _iter_drift_warning_md_lines(summary)


def render_markdown(
    plan: Plan,
    *,
    visible_states: frozenset[DiffState] | None = None,
    filter_query: str | None = None,
) -> str:
    """Render plan diff as markdown suitable for PR/MR comments.

    Returns the complete markdown string. The caller decides whether to print it,
    write it to a file, or post it to an API.
    """
    resources = merge_sub_resources(plan.resources)
    if not resources:
        raise DagshundError("plan is empty")
    plan = replace(plan, resources=resources)

    resource_filter = None
    if filter_query:
        from dagshund.filter import build_query_predicate

        resource_filter = build_query_predicate(filter_query)

    lines: list[str] = []
    lines.extend(_render_header(plan))

    if not detect_changes(resources):
        lines.append(f"No changes ({len(resources)} resources unchanged)")
        return "\n".join(lines)

    lines.extend(
        _render_resource_groups(
            group_by_resource_type(resources),
            visible_states=visible_states,
            resource_filter=resource_filter,
        )
    )
    lines.extend(_render_summary(resources, visible_states=visible_states, resource_filter=resource_filter))

    warnings = collect_warnings(resources, visible_states=visible_states, resource_filter=resource_filter)
    if warnings:
        lines.extend(_render_warnings(warnings))

    drift_summaries = collect_drift_summaries(resources, visible_states=visible_states, resource_filter=resource_filter)
    if drift_summaries:
        lines.extend(_render_drift_warnings(drift_summaries))

    return "\n".join(lines)
