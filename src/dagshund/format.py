import re
from collections import Counter
from collections.abc import Callable, Iterator, Mapping, Sized
from dataclasses import dataclass
from itertools import groupby
from typing import cast

from dagshund.change_path import FieldChangeContext, extract_list_element_semantic
from dagshund.model import UNSET, ActionType, FieldChange, ResourceChange
from dagshund.plan import (
    ResourceLossRisk,
    action_to_diff_state,
    classify_resource_drift,
    classify_resource_loss_risk,
    has_drifted_field,
    is_topology_drift_change,
)
from dagshund.types import (
    DiffState,
    ResourceKey,
    ResourceType,
    parse_resource_key,
)
from dagshund.wheel import WheelUpdateUsage


@dataclass(frozen=True, slots=True)
class ActionConfig:
    display: str
    symbol: str
    show_field_changes: bool = False


@dataclass(frozen=True, slots=True)
class DriftSummary:
    resource_type: str
    resource_name: str
    overwritten_field_count: int
    # Sorted (noun, label) pairs. e.g. ("task", "transform"), ("grant", "data_engineers").
    reentries: tuple[tuple[str, str], ...]


ACTIONS: dict[ActionType, ActionConfig] = {
    ActionType.EMPTY: ActionConfig("unchanged", "="),
    ActionType.CREATE: ActionConfig("create", "+"),
    ActionType.DELETE: ActionConfig("delete", "-"),
    ActionType.UPDATE: ActionConfig("update", "~", show_field_changes=True),
    ActionType.RECREATE: ActionConfig("recreate", "~", show_field_changes=True),
    ActionType.RESIZE: ActionConfig("resize", "~", show_field_changes=True),
    ActionType.UPDATE_ID: ActionConfig("update_id", "~", show_field_changes=True),
    ActionType.SKIP: ActionConfig("unchanged", "="),
}

REMOTE_ONLY_ACTION = ActionConfig("remote", "=")
DEFAULT_ACTION = ActionConfig("unknown", "?")


def action_config(action: ActionType) -> ActionConfig:
    return ACTIONS.get(action, DEFAULT_ACTION)


def field_action_config(change: FieldChange, ctx: FieldChangeContext | None = None) -> ActionConfig:
    """Derive the display config for a field change from data presence, not the action label.

    The Databricks CLI reports 'update' for fields within an updated resource even when
    the field itself is new (only 'new', no 'old') or removed (only 'old', no 'new').
    Derive the effective action from the data shape: new-only → create, old-only → delete,
    both → update.

    When ``ctx`` is provided, per-element list changes (keys ending in
    ``[field='value']``) consult the parent state to disambiguate shapes that
    are structurally identical to unrelated semantics — e.g. a list element
    present only on the remote looks like a remote-only field, but is actually
    a delete. See ``change_path.extract_list_element_semantic``.
    """
    base = ACTIONS.get(change.action, DEFAULT_ACTION)

    # Only override for actions that show field changes — resource-level symbols are fine
    if not base.show_field_changes:
        return base

    if ctx is not None:
        semantic = extract_list_element_semantic(ctx)
        if semantic is not None:
            # ListElementSemantic values ("create" / "delete" / "update") are
            # exact ActionType string values — StrEnum constructor does the mapping.
            return ACTIONS[ActionType(semantic)]

    has_old, has_new = change.old is not UNSET, change.new is not UNSET
    if has_new and not has_old:
        return ACTIONS[ActionType.CREATE]
    if has_old and not has_new:
        return ACTIONS[ActionType.DELETE]
    if not has_old and not has_new and change.remote is not UNSET:
        return REMOTE_ONLY_ACTION
    return base


_INLINE_LIMIT = 60


def _format_collection_inline(value: object) -> str:
    if isinstance(value, dict):
        parts = [f"{k}: {format_value(v)}" for k, v in value.items()]
        return "{" + ", ".join(parts) + "}"
    if isinstance(value, list):
        return "[" + ", ".join(format_value(item) for item in value) + "]"
    return repr(value)


def format_value(value: object) -> str:
    match value:
        case None:
            return "null"
        case str():
            return f'"{value}"'
        # bool must precede int — isinstance(True, int) is True in Python
        case bool():
            return "true" if value else "false"
        case int() | float():
            return str(value)
        case dict() | list():
            return _format_collection_inline(value)
        case _:
            return repr(value)


def is_long_string(value: object) -> bool:
    return isinstance(value, str) and len(value) > 40


def format_display_value(value: object) -> str:
    if is_long_string(value):
        return "..."
    inline = format_value(value)
    if isinstance(value, (dict, list)) and len(inline) > _INLINE_LIMIT:
        return _format_collection_summary(value)
    return inline


def format_transition(old: object, new: object) -> str:
    return f": {format_display_value(old)} -> {format_display_value(new)}"


def _format_collection_summary(value: Sized) -> str:
    if isinstance(value, dict):
        return f"{{{len(value)} fields}}"
    return f"[{len(value)} items]"


def format_field_suffix(change: FieldChange, ctx: FieldChangeContext | None = None) -> str | None:
    has_old, has_new = change.old is not UNSET, change.new is not UNSET
    has_remote = change.remote is not UNSET

    # List-element reclassification: for bundle-managed lists the CLI emits
    # shapes that are ambiguous with unrelated semantics. When ctx lets us
    # disambiguate, take over ONLY when the shape would otherwise misclassify —
    # i.e. remote-only shape on a list-element path. When old/new are populated
    # the shape-based logic below already renders correctly (delete body from
    # change.old, create body from change.new, etc.), including collection
    # summaries via format_display_value. Tag drift on reclassified deletes
    # when the enclosing resource independently shows shape-based drift.
    #
    # Note: this gate differs from `field_action_config`, which tries ctx
    # unconditionally. The suffix branch preserves the existing old→new body
    # formatting path for legitimate transitions; action-config has no such
    # competing path — the override there always agrees with shape when shape
    # is not remote-only, so an ungated ctx lookup is safe.
    if ctx is not None and not has_old and not has_new and has_remote:
        semantic = extract_list_element_semantic(ctx)
        if semantic == "delete":
            tag = " (drift)" if has_drifted_field(change, ctx) else ""
            return f": {format_value(change.remote)}{tag}"
        if semantic == "create":
            return f": {format_display_value(change.remote)}"

    # Drift: old == new but remote differs — show what the deploy will overwrite
    if has_drifted_field(change):
        return f": {format_value(change.remote)} -> {format_value(change.new)} (drift)"

    # No-op: old == new with no meaningful remote difference — suppress
    if has_old and has_new and change.old == change.new:
        return None

    # Remote-only: server has a value the bundle doesn't manage
    if not has_old and not has_new and has_remote:
        return f": {format_value(change.remote)} (remote)"

    if has_old and has_new:
        return format_transition(change.old, change.new)
    if has_new:
        return f": {format_display_value(change.new)}"
    if has_old:
        return f": {format_display_value(change.old)}"
    return ""


# Captures optional noun segment + single-quoted label in final bracket group.
# Works for "tasks[task_key='t']", "grants.[principal='p']", "foo.bar[k='v']",
# and "[principal='x']" (fallback to "entity").
_DRIFT_KEY_RE = re.compile(r"(?:^|\.)([A-Za-z_][A-Za-z0-9_]*)?\.?\[[^\[\]]*'([^']*)'\][^\[\]]*$")


def _singularize(plural: str) -> str:
    """Singularize a collection noun for observed plan.json collection names.

    Unknown shapes round-trip unchanged. Handles ``libraries -> library`` (ies→y)
    and ``tasks -> task`` / ``grants -> grant`` (s→). Preserves ``*ss`` endings
    (e.g. ``class``) to avoid mangling them into ``clas``.
    """
    if plural.endswith("ies"):
        return f"{plural[:-3]}y"
    if plural.endswith("s") and not plural.endswith("ss"):
        return plural[:-1]
    return plural


def _extract_drift_label_noun(key: str) -> tuple[str, str]:
    match = _DRIFT_KEY_RE.search(key)
    if match is None:
        return "entity", key
    noun_raw = cast("str | None", match.group(1))
    label = cast("str", match.group(2))
    return (_singularize(noun_raw) if noun_raw else "entity"), label


def format_drift_reentries(keys: tuple[str, ...]) -> tuple[tuple[str, str], ...]:
    return tuple(sorted(_extract_drift_label_noun(key) for key in keys))


def iter_non_topology_field_changes(
    changes: Mapping[str, FieldChange],
    *,
    new_state: object | None = None,
    remote_state: object | None = None,
    shape_drift: bool = False,
) -> Iterator[tuple[str, FieldChange, FieldChangeContext]]:
    """Yield sorted ``(name, change, ctx)`` with topology-drift entries excluded.

    Single source of truth for the ``field vs re-add`` partition shared by the
    terminal and markdown renderers. The context travels alongside each change
    so the per-renderer plumbing stays identical.
    """
    for name, change in sorted(changes.items()):
        if is_topology_drift_change(change):
            continue
        yield (
            name,
            change,
            FieldChangeContext(
                change_key=name,
                new_state=new_state,
                remote_state=remote_state,
                resource_has_shape_drift=shape_drift,
            ),
        )


def _resource_type_of(entry: tuple[ResourceKey, ResourceChange]) -> ResourceType:
    return parse_resource_key(entry[0])[0]


def group_by_resource_type(
    resources: Mapping[ResourceKey, ResourceChange],
) -> dict[ResourceType, dict[ResourceKey, ResourceChange]]:
    sorted_entries = sorted(resources.items(), key=_resource_type_of)
    grouped = groupby(sorted_entries, key=_resource_type_of)
    return {resource_type: dict(group) for resource_type, group in grouped}


def iter_visible_resources(
    resources: Mapping[ResourceKey, ResourceChange],
    *,
    visible_states: frozenset[DiffState] | None = None,
    resource_filter: Callable[[ResourceKey, ResourceChange], bool] | None = None,
) -> Iterator[tuple[ResourceKey, ResourceChange]]:
    for key, entry in sorted(resources.items()):
        if visible_states is not None and action_to_diff_state(entry.action) not in visible_states:
            continue
        if resource_filter is not None and not resource_filter(key, entry):
            continue
        yield key, entry


def filter_resources(
    entries: Mapping[ResourceKey, ResourceChange],
    *,
    visible_states: frozenset[DiffState] | None = None,
    resource_filter: Callable[[ResourceKey, ResourceChange], bool] | None = None,
) -> dict[ResourceKey, ResourceChange]:
    return dict(
        iter_visible_resources(
            entries,
            visible_states=visible_states,
            resource_filter=resource_filter,
        )
    )


def count_by_action(entries: Mapping[ResourceKey, ResourceChange]) -> dict[ActionConfig, int]:
    return dict(Counter(action_config(entry.action) for entry in entries.values()))


def count_effects_by_action(entries: Mapping[ResourceKey, ResourceChange]) -> dict[ActionConfig, int]:
    """Tally deploy-triggered runs by action, separate from the resource tally —
    a job stays unchanged while its runs create/recreate/delete (dagshund-ocb1)."""
    return dict(Counter(action_config(effect.action) for entry in entries.values() for effect in entry.effects))


def format_group_header(resource_type: ResourceType, total: int, visible: int) -> str:
    """Format group header: 'type (N)' or 'type (visible/total)' when filtered."""
    count = f"({visible}/{total})" if visible != total else f"({total})"
    return f"{resource_type} {count}"


_STATEFUL_RESOURCE_WARNINGS: dict[str, str] = {
    "catalogs": "all schemas, tables, and volumes in this catalog will be lost",
    "schemas": "all tables, views, and volumes in this schema will be lost",
    "volumes": "all files in this volume will be lost",
    "registered_models": "all model versions will be lost",
    "experiments": "all experiment runs and metrics will be lost",
    "database_instances": "all catalogs and tables on this instance will be lost",
    "postgres_projects": "all branches and endpoints in this project will be lost",
    "postgres_branches": "all data on this branch will be lost",
    "postgres_databases": "all data in this Lakebase database will be lost",
}


def _format_resource_loss_risk(resource_type: str, risk: ResourceLossRisk) -> str:
    if risk == "stateful":
        return _STATEFUL_RESOURCE_WARNINGS[resource_type]
    datasets = "pipeline-managed materialized views, streaming tables, and views"
    if risk == "pipeline-cascade-enabled":
        return f"{datasets} will also be deleted"
    return f"{datasets} may also be deleted because cascade_on_destroy is unavailable in this plan"


def collect_warnings(
    resources: Mapping[ResourceKey, ResourceChange],
    *,
    visible_states: frozenset[DiffState] | None = None,
    resource_filter: Callable[[ResourceKey, ResourceChange], bool] | None = None,
) -> list[str]:
    warnings: list[str] = []
    for key, entry in iter_visible_resources(
        resources,
        visible_states=visible_states,
        resource_filter=resource_filter,
    ):
        resource_type, resource_name = parse_resource_key(key)
        risk = classify_resource_loss_risk(resource_type, entry)
        if risk is None:
            continue
        action_display = action_config(entry.action).display
        description = _format_resource_loss_risk(resource_type, risk)
        warnings.append(f"{resource_type}/{resource_name} will be {action_display}d \u2014 {description}")
    return warnings


def _summarize_resource_drift(key: ResourceKey, entry: ResourceChange) -> DriftSummary | None:
    drift = classify_resource_drift(entry)
    if not drift.has_drift:
        return None
    resource_type, resource_name = parse_resource_key(key)
    return DriftSummary(
        resource_type=resource_type,
        resource_name=resource_name,
        overwritten_field_count=len(drift.overwritten_fields),
        reentries=format_drift_reentries(drift.topology_readds),
    )


def collect_drift_summaries(
    resources: Mapping[ResourceKey, ResourceChange],
    *,
    visible_states: frozenset[DiffState] | None = None,
    resource_filter: Callable[[ResourceKey, ResourceChange], bool] | None = None,
) -> list[DriftSummary]:
    visible = iter_visible_resources(resources, visible_states=visible_states, resource_filter=resource_filter)
    return [summary for key, entry in visible if (summary := _summarize_resource_drift(key, entry))]


def _format_count_noun(count: int, noun: str) -> str:
    return f"{count} {noun}" if count == 1 else f"{count} {noun}s"


def format_wheel_update_body(usage: WheelUpdateUsage) -> str:
    """Build the shared body of a wheel summary line: 'wheel etl_lib updated: 0.1.0 -> 0.2.0 (8 tasks)'.

    Renderers wrap this with their own prefix, mirroring ``format_drift_subline_body``.
    Carriers are tasks (classic compute), environments (serverless), or both.
    Equal versions (wheel path moved, same build) drop the version transition.
    """
    update = usage.update
    carriers = ", ".join(
        part
        for part in (
            _format_count_noun(usage.task_count, "task") if usage.task_count else "",
            _format_count_noun(usage.environment_count, "environment") if usage.environment_count else "",
        )
        if part
    )
    versions = f": {update.old_version} -> {update.new_version}" if update.old_version != update.new_version else ""
    return f"wheel {update.distribution} updated{versions} ({carriers})"


def format_drift_subline_body(count: int, noun: str, suffix: str, labels: str = "") -> str:
    """Build the shared body of a drift sub-line: '1 task will be re-added (transform)'.

    Renderers wrap this with their own prefix ('      ' for terminal, '>   - ' for
    markdown nested bullets). Centralizing the pluralization + labels logic keeps
    the copy in lockstep across outputs.
    """
    body = f"{_format_count_noun(count, noun)} will be {suffix}"
    return f"{body} ({labels})" if labels else body
