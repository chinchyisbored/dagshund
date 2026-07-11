import re
from collections.abc import Mapping
from dataclasses import replace
from typing import Any, cast

from dagshund.model import (
    UNSET,
    ActionType,
    FieldChange,
    JobRunEffect,
    ResourceChange,
)
from dagshund.types import ResourceKey, parse_resource_key


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
    new_value = _extract_state_value(sub_entry.new_state)
    if new_value is not None:
        return new_value
    if isinstance(sub_entry.remote_state, dict):
        return cast("dict[str, object]", sub_entry.remote_state)
    return None


def _resolve_sub_new_state(sub_entry: ResourceChange) -> dict[str, object] | None:
    return _extract_state_value(sub_entry.new_state)


def _resolve_sub_remote_state(sub_entry: ResourceChange) -> dict[str, object] | None:
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
    sub_new_state = _resolve_sub_new_state(sub_entry)
    sub_remote_state = _resolve_sub_remote_state(sub_entry)

    new_state: object = parent_entry.new_state
    parent_new_value = _extract_state_value(parent_entry.new_state)
    if parent_new_value is not None and sub_new_state is not None and isinstance(parent_entry.new_state, dict):
        new_state = {
            **parent_entry.new_state,
            "value": {**parent_new_value, suffix: sub_new_state},
        }

    remote_state: object = parent_entry.remote_state
    if sub_remote_state is not None:
        base = parent_entry.remote_state if isinstance(parent_entry.remote_state, dict) else {}
        remote_state = {**base, suffix: sub_remote_state}

    return new_state, remote_state


def _merge_external_deps(
    parent_deps: tuple[tuple[str, str | None], ...],
    sub_deps: tuple[tuple[str, str | None], ...],
    parent_key: ResourceKey,
) -> tuple[tuple[str, str | None], ...]:
    """Drop self-refs (cycles) and rewrite sub-resource-key targets to parent keys (gone post-merge)."""
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


# Plan entry types treated as deploy effects, not resources.
# Mirror of EFFECT_TYPE_SPECS in js/src/utils/normalize-plan.ts.
_EFFECT_RESOURCE_TYPES: frozenset[str] = frozenset({"job_runs"})


def _extract_job_run_target_id(entry: ResourceChange) -> int | None:
    """Numeric target job_id from new_state.value, falling back to remote_state."""
    new_value = _extract_state_value(entry.new_state)
    candidate: object = new_value.get("job_id") if new_value is not None else None
    if not isinstance(candidate, int) and isinstance(entry.remote_state, dict):
        candidate = cast("dict[str, Any]", entry.remote_state).get("job_id")
    if isinstance(candidate, int) and not isinstance(candidate, bool) and candidate != 0:
        return candidate
    return None


def _build_job_id_map(resources: Mapping[ResourceKey, ResourceChange]) -> dict[int, ResourceKey]:
    """Numeric remote_state.job_id -> resource key. Mirror of buildJobIdMap in
    js/src/graph/resolve-run-job-target.ts."""
    result: dict[int, ResourceKey] = {}
    for key, entry in resources.items():
        if not isinstance(entry.remote_state, dict):
            continue
        job_id = cast("dict[str, Any]", entry.remote_state).get("job_id")
        if isinstance(job_id, int) and not isinstance(job_id, bool) and job_id != 0:
            result[job_id] = key
    return result


def _resolve_effect_target(
    entry: ResourceChange,
    targets: Mapping[ResourceKey, ResourceChange],
    job_id_map: Mapping[int, ResourceKey],
) -> ResourceKey | None:
    """Prefer the symbolic depends_on reference, fall back to numeric id lookup.

    The id map is built from job entries only, so a numeric match is always a job.
    """
    for node, _label in entry.depends_on:
        if parse_resource_key(node)[0] == "jobs" and node in targets:
            return node
    target_id = _extract_job_run_target_id(entry)
    return job_id_map.get(target_id) if target_id is not None else None


# run_page_url values become markdown link targets, and plan files are
# arbitrary local input — accept only http(s) URLs free of whitespace and
# link-delimiter characters. Checked with fullmatch because Python's `$`
# would tolerate a trailing newline. Mirror of RUN_PAGE_URL_PATTERN in
# js/src/utils/normalize-plan.ts (where an unflagged `$` is end-of-string).
_RUN_PAGE_URL_PATTERN = re.compile(r"https?://[^\s<>()\\]+")


def _extract_run_page_url(remote_state: object) -> str | None:
    if not isinstance(remote_state, dict):
        return None
    run_page_url = cast("dict[str, Any]", remote_state).get("run_page_url")
    if isinstance(run_page_url, str) and _RUN_PAGE_URL_PATTERN.fullmatch(run_page_url):
        return run_page_url
    return None


def _build_job_run_effect(name: str, entry: ResourceChange) -> JobRunEffect:
    return JobRunEffect(
        name=name,
        action=entry.action,
        changes=entry.changes,
        run_page_url=_extract_run_page_url(entry.remote_state),
    )


def normalize_plan(
    resources: Mapping[ResourceKey, ResourceChange],
) -> dict[ResourceKey, ResourceChange]:
    """Merge sub-resources, then fold job_runs entries onto their target jobs as effects.

    The target's own action/changes/state stay untouched — effects never promote
    the parent. Orphan effects (target job absent from the plan) stay standalone
    entries; text mode has no phantom-node concept. Mirror of ``normalizePlan``
    in ``js/src/utils/normalize-plan.ts``.
    """
    merged = merge_sub_resources(resources)
    targets: dict[ResourceKey, ResourceChange] = {}
    effect_entries: list[tuple[ResourceKey, ResourceChange]] = []
    for key, entry in merged.items():
        if parse_resource_key(key)[0] in _EFFECT_RESOURCE_TYPES:
            effect_entries.append((key, entry))
        else:
            targets[key] = entry
    if not effect_entries:
        return targets

    # Built from job entries only — effect entries carry the target's job_id in
    # their own remote_state, and any other resource sharing the id must neither
    # shadow the job (map insertion is last-wins) nor receive the effect.
    job_id_map = _build_job_id_map(
        {key: entry for key, entry in targets.items() if parse_resource_key(key)[0] == "jobs"}
    )
    effects_by_target: dict[ResourceKey, list[JobRunEffect]] = {}
    for key, entry in effect_entries:
        target_key = _resolve_effect_target(entry, targets, job_id_map)
        if target_key is None:
            targets[key] = entry
        else:
            name = parse_resource_key(key)[1]
            effects_by_target.setdefault(target_key, []).append(_build_job_run_effect(name, entry))

    for target_key, effects in effects_by_target.items():
        ordered = tuple(sorted(effects, key=lambda effect: effect.name))
        targets[target_key] = replace(targets[target_key], effects=ordered)
    return targets


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
