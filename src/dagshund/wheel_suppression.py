"""Pure effective presentation projection for routine wheel artifact updates."""

from collections import defaultdict
from collections.abc import Mapping
from dataclasses import dataclass, replace

from dagshund.model import UNSET, ActionType, FieldChange, ResourceChange, compare_field_values
from dagshund.types import ResourceKey, parse_resource_key
from dagshund.wheel import (
    WheelUpdate,
    WheelUpdateUsage,
    classify_wheel_update,
    summarize_wheel_updates,
)


@dataclass(frozen=True, slots=True)
class WheelSuppression:
    resources: Mapping[ResourceKey, ResourceChange]
    usages: tuple[WheelUpdateUsage, ...]


def _is_proven_noop(change: FieldChange) -> bool:
    return (
        change.action in (ActionType.EMPTY, ActionType.SKIP)
        and change.old is not UNSET
        and change.new is not UNSET
        and change.remote is not UNSET
        and compare_field_values(change, "old", "new") is True
        and compare_field_values(change, "old", "remote") is True
    )


def apply_wheel_suppression(resources: Mapping[ResourceKey, ResourceChange]) -> WheelSuppression:
    """Suppress only supported wheel scalar updates, preserving all raw evidence."""
    effective: dict[ResourceKey, ResourceChange] = {}
    updates_by_resource: dict[ResourceKey, dict[str, WheelUpdate]] = {}
    for resource_key, entry in resources.items():
        resource_type, _ = parse_resource_key(resource_key)
        if resource_type not in {"jobs", "pipelines"} or entry.action != ActionType.UPDATE:
            effective[resource_key] = entry
            continue
        updates = {
            key: update
            for key, change in entry.changes.items()
            if change.action == ActionType.UPDATE
            and (update := classify_wheel_update(key, change, resource_type)) is not None
        }
        if not updates:
            effective[resource_key] = entry
            continue
        updates_by_resource[resource_key] = updates
        remaining = {
            key: change for key, change in entry.changes.items() if key not in updates and not _is_proven_noop(change)
        }
        has_substantive_change = any(
            change.action not in (ActionType.EMPTY, ActionType.SKIP)
            or (
                change.action == ActionType.UPDATE
                and change.old is not UNSET
                and change.new is not UNSET
                and change.remote is UNSET
                and compare_field_values(change, "old", "new") is True
            )
            for change in remaining.values()
        )
        effective[resource_key] = replace(
            entry,
            action=entry.action if has_substantive_change else ActionType.SKIP,
            changes=remaining,
        )

    grouped: defaultdict[tuple[str, str, str], list[WheelUpdateUsage]] = defaultdict(list)
    update_by_identity: dict[tuple[str, str, str], WheelUpdate] = {}
    for resource_key, updates in updates_by_resource.items():
        for usage in summarize_wheel_updates(updates, resource_key):
            identity = (
                usage.update.distribution,
                usage.update.old_requirement,
                usage.update.new_requirement,
            )
            grouped[identity].append(usage)
            update_by_identity[identity] = usage.update
    usages = tuple(
        WheelUpdateUsage(
            update=update_by_identity[identity],
            task_count=sum(item.task_count for item in items),
            environment_count=sum(item.environment_count for item in items),
            pipeline_count=sum(item.pipeline_count for item in items),
        )
        for identity, items in sorted(grouped.items(), key=lambda item: item[0])
    )
    return WheelSuppression(resources=effective, usages=usages)
