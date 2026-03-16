"""Merge sub-resources into their parent entries."""

from typing import Any

from dagshund.types import (
    ResourceChange,
    ResourceChanges,
    ResourceKey,
    extract_parent_resource_key,
    extract_sub_resource_suffix,
    is_sub_resource_key,
)


def _prefix_changes(suffix: str, changes: dict[str, Any] | None) -> dict[str, Any] | None:
    """Prefix each change key with `suffix.` so merged changes are namespaced."""
    if not changes:
        return None
    return {f"{suffix}.{key}": value for key, value in changes.items()}


def _extract_state_value(state: object) -> dict[str, object] | None:
    """Extract the inner value from a state wrapper (`{ "value": ... }` or bare dict)."""
    if not isinstance(state, dict):
        return None
    inner = state.get("value")  # type: ignore[arg-type]  # dict narrowed from object
    if isinstance(inner, dict):
        return inner
    return None


def _resolve_sub_state(sub_entry: ResourceChange) -> dict[str, object] | None:
    """Resolve the best available state from a sub-resource: prefer new_state.value, fall back to remote_state."""
    new_value = _extract_state_value(sub_entry.get("new_state"))
    if new_value is not None:
        return new_value
    remote = sub_entry.get("remote_state")
    if isinstance(remote, dict):
        return remote
    return None


def _inject_state(
    parent_entry: ResourceChange,
    suffix: str,
    sub_entry: ResourceChange,
) -> dict[str, object]:
    """Inject sub-resource state under `suffix` key in parent's state."""
    result: dict[str, object] = {}
    sub_state = _resolve_sub_state(sub_entry)

    # Inject into new_state.value — requires BOTH parent and sub to have state,
    # because new_state uses the { "value": ..., "vars": ... } wrapper that we can't fabricate.
    # remote_state below is more lenient: it's a bare object, so we can create one from scratch.
    parent_new_value = _extract_state_value(parent_entry.get("new_state"))
    if parent_new_value is not None and sub_state is not None:
        result["new_state"] = {
            **parent_entry["new_state"],
            "value": {**parent_new_value, suffix: sub_state},
        }
    else:
        result["new_state"] = parent_entry.get("new_state")

    parent_remote = parent_entry.get("remote_state")
    if sub_state is not None:
        base = parent_remote if isinstance(parent_remote, dict) else {}
        result["remote_state"] = {**base, suffix: sub_state}
    else:
        result["remote_state"] = parent_remote

    return result


def _merge_external_deps(
    parent_deps: list[dict[str, str]] | None,
    sub_deps: list[dict[str, str]] | None,
    parent_key: ResourceKey,
) -> list[dict[str, str]] | None:
    """Merge external depends_on from sub into parent, dropping self-referential entries
    and rewriting sub-resource-key targets to their parent key."""
    if not sub_deps:
        return parent_deps
    external = []
    for dep in sub_deps:
        node = dep.get("node", "")
        if node == parent_key:
            continue
        if is_sub_resource_key(node):
            external.append({**dep, "node": extract_parent_resource_key(node)})
        else:
            external.append(dep)
    if not external:
        return parent_deps
    return [*(parent_deps or []), *external]


def _promote_action(parent_action: str, sub_action: str) -> str:
    """Promote parent action if it's skip/empty and sub has a real action."""
    parent_inactive = parent_action in ("", "skip")
    sub_active = sub_action not in ("", "skip")
    return "update" if parent_inactive and sub_active else parent_action


def _synthesize_whole_field_change(suffix: str, sub_entry: ResourceChange) -> dict[str, Any] | None:
    """Synthesize a whole-field change for a sub-resource with a destructive/constructive action
    but no field-level changes."""
    action = sub_entry.get("action", "")
    if action in ("", "skip"):
        return None
    changes = sub_entry.get("changes")
    if changes:
        return None

    sub_state = _resolve_sub_state(sub_entry)
    change: dict[str, Any] = {"action": action}
    if action == "delete" and sub_state is not None:
        change["old"] = sub_state
    if action == "create" and sub_state is not None:
        change["new"] = sub_state
    return {suffix: change}


def _merge_single_sub(
    parent_entry: ResourceChange,
    suffix: str,
    sub_entry: ResourceChange,
    parent_key: ResourceKey,
) -> ResourceChange:
    """Merge a single sub-resource into its parent entry."""
    prefixed = _prefix_changes(suffix, sub_entry.get("changes")) or _synthesize_whole_field_change(suffix, sub_entry)
    parent_changes = parent_entry.get("changes")
    merged_changes: dict[str, Any] | None = None
    if prefixed is not None or parent_changes is not None:
        merged_changes = {**(parent_changes or {}), **(prefixed or {})}

    state_update = _inject_state(parent_entry, suffix, sub_entry)
    merged_deps = _merge_external_deps(
        parent_entry.get("depends_on"),
        sub_entry.get("depends_on"),
        parent_key,
    )

    result: ResourceChange = {
        **parent_entry,
        "action": _promote_action(parent_entry.get("action", ""), sub_entry.get("action", "")),
        **state_update,
    }
    if merged_changes is not None:
        result["changes"] = merged_changes
    if merged_deps is not None:
        result["depends_on"] = merged_deps

    return result


def merge_sub_resources(resources: ResourceChanges) -> ResourceChanges:
    """Merge sub-resources into their parent entries.

    Sub-resource keys (>3 dot-segments) are absorbed into the parent;
    orphans (parent not in plan) are kept as standalone entries.
    """
    parents: ResourceChanges = {}
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
