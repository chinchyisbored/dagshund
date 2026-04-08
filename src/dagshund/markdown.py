"""Markdown rendering of plan diffs for PR/MR comments."""

from collections.abc import Callable, Iterator

from dagshund.format import (
    action_config,
    collect_drift_warnings,
    collect_warnings,
    count_by_action,
    detect_drift_fields,
    filter_resources,
    format_field_suffix,
    format_group_header,
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

_BLOCK_INDENT = 6  # 2 (list indent) + 4 (content offset for multiline blocks)


def _render_field_change(field_name: str, change: FieldChange) -> str | None:
    """Render a single field-level change as a markdown list item, or None if unchanged/no-op."""
    action = str(change.get("action", ""))
    if action_to_diff_state(action) == DiffState.UNCHANGED:
        return None

    suffix = format_field_suffix(change, block_indent=_BLOCK_INDENT)
    if suffix is None:
        return None

    cfg = action_config(action)
    return f"  - `{cfg.symbol}` `{field_name}`{suffix}"


def _render_resource(
    key: ResourceKey,
    entry: ResourceChange,
) -> Iterator[str]:
    """Render a single resource entry as markdown list items."""
    action = entry.get("action", "")
    cfg = action_config(action)
    resource_type, resource_name = parse_resource_key(key)

    label = f" \u2014 {cfg.display}" if action_to_diff_state(action) != DiffState.UNCHANGED else ""
    yield f"- `{cfg.symbol}` `{resource_type}/{resource_name}`{label}"

    changes = entry.get("changes", {})
    if is_field_changes(changes) and cfg.show_field_changes and detect_drift_fields(changes):
        yield "  - :warning: manually edited outside bundle"

    if is_field_changes(changes) and changes and cfg.show_field_changes:
        for field_name, change in sorted(changes.items()):
            if not isinstance(change, dict):
                continue
            rendered = _render_field_change(field_name, change)
            if rendered is not None:
                yield rendered


def _render_header(plan: Plan) -> Iterator[str]:
    """Render the plan version header."""
    cli_version = plan.get("cli_version", "unknown")
    plan_version = plan.get("plan_version", "?")
    yield f"### dagshund plan (v{plan_version}, cli {cli_version})"
    yield ""


def _render_resource_groups(
    resource_groups: ResourceChangesByType,
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
    resources: ResourceChanges,
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


def _render_drift_warnings(warnings: list[str]) -> Iterator[str]:
    """Render drift warnings as a GitHub/GitLab alert block."""
    yield ""
    yield "> [!WARNING]"
    yield "> **Manual Edits Detected**"
    for warning in warnings:
        yield f"> - {warning}"


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

    drift_warnings = collect_drift_warnings(resources, visible_states=visible_states, resource_filter=resource_filter)
    if drift_warnings:
        lines.extend(_render_drift_warnings(drift_warnings))

    return "\n".join(lines)
