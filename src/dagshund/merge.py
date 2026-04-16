"""Merge sub-resources into their parent entries."""

from collections.abc import Mapping
from dataclasses import replace
from typing import Any, cast

from dagshund.model import (
    UNSET,
    ActionType,
    FieldChange,
    ResourceChange,
)
from dagshund.types import ResourceKey


def extract_parent_resource_key(key: ResourceKey) -> ResourceKey:
    """'resources.jobs.test_job.permissions' → 'resources.jobs.test_job'"""
    return ".".join(key.split(".")[:3])


def extract_sub_resource_suffix(key: ResourceKey) -> str:
    """'resources.jobs.test_job.permissions' → 'permissions'"""
    return ".".join(key.split(".")[3:])


def is_sub_resource_key(key: ResourceKey) -> bool:
    """Sub-resources have >3 dot segments like 'resources.jobs.test_job.permissions'."""
    return len(key.split(".")) > 3


def _prefix_changes(
    suffix: str,
    changes: Mapping[str, FieldChange],
) -> dict[str, FieldChange] | None:
    """Prefix each change key with `suffix.` so merged changes are namespaced."""
    if not changes:
        return None
    return {f"{suffix}.{key}": value for key, value in changes.items()}


def _extract_state_value(state: object) -> dict[str, object] | None:
    """Extract the inner value from a state wrapper (`{ "value": ... }` or bare dict)."""
    if not isinstance(state, dict):
        return None
    inner = cast("dict[str, Any]", state).get("value")
    if isinstance(inner, dict):
        return cast("dict[str, object]", inner)
    return None


def _resolve_sub_state(sub_entry: ResourceChange) -> dict[str, object] | None:
    """Resolve the best available state from a sub-resource: prefer new_state.value, fall back to remote_state."""
    new_value = _extract_state_value(sub_entry.new_state)
    if new_value is not None:
        return new_value
    if isinstance(sub_entry.remote_state, dict):
        return cast("dict[str, object]", sub_entry.remote_state)
    return None


def _inject_state(
    parent_entry: ResourceChange,
    suffix: str,
    sub_entry: ResourceChange,
) -> tuple[object, object]:
    """Inject sub-resource state under `suffix` key in parent's state.

    Returns (new_state, remote_state). new_state injection requires BOTH parent
    and sub to have state, because new_state uses the { "value": ..., "vars": ... }
    wrapper that we can't fabricate. remote_state below is more lenient: it's
    a bare object, so we can create one from scratch.
    """
    sub_state = _resolve_sub_state(sub_entry)

    new_state: object = parent_entry.new_state
    parent_new_value = _extract_state_value(parent_entry.new_state)
    if parent_new_value is not None and sub_state is not None and isinstance(parent_entry.new_state, dict):
        new_state = {
            **parent_entry.new_state,
            "value": {**parent_new_value, suffix: sub_state},
        }

    remote_state: object = parent_entry.remote_state
    if sub_state is not None:
        base = parent_entry.remote_state if isinstance(parent_entry.remote_state, dict) else {}
        remote_state = {**base, suffix: sub_state}

    return new_state, remote_state


def _merge_external_deps(
    parent_deps: tuple[tuple[str, str | None], ...],
    sub_deps: tuple[tuple[str, str | None], ...],
    parent_key: ResourceKey,
) -> tuple[tuple[str, str | None], ...]:
    """Merge external depends_on from sub into parent, dropping self-referential entries
    and rewriting sub-resource-key targets to their parent key."""
    if not sub_deps:
        return parent_deps
    external: list[tuple[str, str | None]] = []
    for node, label in sub_deps:
        if node == parent_key:
            continue
        rewritten = extract_parent_resource_key(node) if is_sub_resource_key(node) else node
        external.append((rewritten, label))
    if not external:
        return parent_deps
    return (*parent_deps, *external)


def _promote_action(parent_action: ActionType, sub_action: ActionType) -> ActionType:
    """Promote parent action if it's skip/empty and sub has a real action."""
    parent_inactive = parent_action in (ActionType.EMPTY, ActionType.SKIP)
    sub_active = sub_action not in (ActionType.EMPTY, ActionType.SKIP)
    return ActionType.UPDATE if parent_inactive and sub_active else parent_action


def _synthesize_whole_field_change(
    suffix: str,
    sub_entry: ResourceChange,
) -> dict[str, FieldChange] | None:
    """Synthesize a whole-field change for a sub-resource with a destructive/constructive action
    but no field-level changes."""
    action = sub_entry.action
    if action in (ActionType.EMPTY, ActionType.SKIP):
        return None
    if sub_entry.changes:
        return None

    sub_state = _resolve_sub_state(sub_entry)
    old: object = sub_state if action == ActionType.DELETE and sub_state is not None else UNSET
    new: object = sub_state if action == ActionType.CREATE and sub_state is not None else UNSET
    change = FieldChange(action=action, reason=None, old=old, new=new, remote=UNSET)
    return {suffix: change}


def _merge_single_sub(
    parent_entry: ResourceChange,
    suffix: str,
    sub_entry: ResourceChange,
    parent_key: ResourceKey,
) -> ResourceChange:
    """Merge a single sub-resource into its parent entry.

    Sub-field keys overwrite parent-field keys on collision — the sub wins.
    This matches the original `{**parent, **prefixed}` semantics and is encoded
    in the merge property tests.
    """
    prefixed = _prefix_changes(suffix, sub_entry.changes) or _synthesize_whole_field_change(suffix, sub_entry)
    merged_changes: Mapping[str, FieldChange] = (
        {**parent_entry.changes, **prefixed} if prefixed is not None else parent_entry.changes
    )

    new_state, remote_state = _inject_state(parent_entry, suffix, sub_entry)
    merged_deps = _merge_external_deps(parent_entry.depends_on, sub_entry.depends_on, parent_key)
    promoted_action = _promote_action(parent_entry.action, sub_entry.action)

    return replace(
        parent_entry,
        action=promoted_action,
        depends_on=merged_deps,
        changes=merged_changes,
        new_state=new_state,
        remote_state=remote_state,
    )


def merge_sub_resources(
    resources: Mapping[ResourceKey, ResourceChange],
) -> dict[ResourceKey, ResourceChange]:
    """Merge sub-resources into their parent entries.

    Sub-resource keys (>3 dot-segments) are absorbed into the parent;
    orphans (parent not in plan) are kept as standalone entries.
    """
    parents: dict[ResourceKey, ResourceChange] = {}
    subs_by_parent: dict[ResourceKey, list[tuple[ResourceKey, ResourceChange]]] = {}

    for key, entry in resources.items():
        if is_sub_resource_key(key):
            parent_key = extract_parent_resource_key(key)
            subs_by_parent.setdefault(parent_key, []).append((key, entry))
        else:
            parents[key] = entry

    for parent_key, subs in subs_by_parent.items():
        if parent_key in parents:
            merged = parents[parent_key]
            for sub_key, sub_entry in subs:
                suffix = extract_sub_resource_suffix(sub_key)
                merged = _merge_single_sub(merged, suffix, sub_entry, parent_key)
            parents[parent_key] = merged
        else:
            for sub_key, sub_entry in subs:
                parents[sub_key] = sub_entry

    return parents
