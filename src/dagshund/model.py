"""Typed domain model for dagshund plan data.

The parser sits at the boundary: `parse_plan` takes a raw JSON string and
returns a `Plan` built from frozen dataclasses. Downstream code walks
`Plan.resources`, `ResourceChange.changes`, and `FieldChange` fields directly —
the `Any` tax is paid once, here, and nowhere else.

Mirrors the TS schema at `js/src/types/plan-schema.ts`:
- typed skeleton around `unknown` payload leaves (`new_state`, `remote_state`, old/new/remote)
- `UNSET` sentinel preserves the JSON distinction between "key omitted" and "key present with null"
"""

import json
from collections.abc import Mapping
from dataclasses import dataclass, field
from enum import Enum, StrEnum
from typing import Any, cast

from dagshund.types import DagshundError, ResourceKey


class ActionType(StrEnum):
    """Action vocabulary mirroring knownActionTypes in js/src/types/plan-schema.ts.

    Cross-file drift lives at plan.py:36 (dagshund-mx55 tracks consolidation).
    """

    EMPTY = ""
    SKIP = "skip"
    CREATE = "create"
    DELETE = "delete"
    UPDATE = "update"
    RECREATE = "recreate"
    RESIZE = "resize"
    UPDATE_ID = "update_id"
    UNKNOWN = "unknown"


_ACTION_VALUES: frozenset[str] = frozenset(a.value for a in ActionType)


def parse_action(value: object) -> ActionType:
    """Coerce a raw action string to an ActionType; unknown strings fall back to UNKNOWN."""
    if isinstance(value, str) and value in _ACTION_VALUES:
        return ActionType(value)
    return ActionType.UNKNOWN


class UnsetSentinel(Enum):
    """Sentinel for distinguishing "key absent" from "key present with null"."""

    UNSET = "UNSET"


UNSET = UnsetSentinel.UNSET


@dataclass(frozen=True, slots=True)
class FieldChange:
    """A single field-level change within a resource.

    `old` / `new` / `remote` are opaque payloads: object for any JSON value,
    `None` when the key was present with JSON null, `UNSET` when the key was
    absent. The presence-vs-null distinction drives drift detection
    (`has_drifted_field`, `is_topology_drift_change`) and display logic.
    """

    action: ActionType = ActionType.EMPTY
    reason: str | None = None
    old: object | UnsetSentinel = UNSET
    new: object | UnsetSentinel = UNSET
    remote: object | UnsetSentinel = UNSET


def parse_field_change(raw: object) -> FieldChange:
    """Build a FieldChange from a raw change dict, preserving key-presence semantics.

    Accepts `object` so callers can pass unchecked JSON payloads; non-dict input
    yields a default-constructed FieldChange.
    """
    if not isinstance(raw, dict):
        return FieldChange()
    raw_map = cast("dict[str, Any]", raw)
    return FieldChange(
        action=parse_action(raw_map.get("action", "")),
        reason=_parse_optional_str(raw_map.get("reason")),
        old=raw_map.get("old", UNSET),
        new=raw_map.get("new", UNSET),
        remote=raw_map.get("remote", UNSET),
    )


def _parse_optional_str(value: object) -> str | None:
    return value if isinstance(value, str) else None


@dataclass(frozen=True, slots=True)
class ResourceChange:
    """A single resource entry in a plan."""

    key: ResourceKey
    action: ActionType = ActionType.EMPTY
    depends_on: tuple[tuple[str, str | None], ...] = ()
    changes: Mapping[str, FieldChange] = field(default_factory=dict)
    new_state: object | None = None
    remote_state: object | None = None


def parse_resource_change(key: ResourceKey, raw: object) -> ResourceChange:
    """Build a ResourceChange from a raw entry dict."""
    if not isinstance(raw, dict):
        return ResourceChange(key=key)
    raw_map = cast("dict[str, Any]", raw)
    raw_changes = raw_map.get("changes")
    changes: dict[str, FieldChange] = {}
    if isinstance(raw_changes, dict):
        for k, v in cast("dict[str, Any]", raw_changes).items():
            if isinstance(k, str):
                changes[k] = parse_field_change(v)

    return ResourceChange(
        key=key,
        action=parse_action(raw_map.get("action", "")),
        depends_on=_parse_depends_on(raw_map.get("depends_on")),
        changes=changes,
        new_state=raw_map.get("new_state"),
        remote_state=raw_map.get("remote_state"),
    )


def _parse_depends_on(value: object) -> tuple[tuple[str, str | None], ...]:
    """Parse the depends_on list into a tuple of (node, label?) tuples."""
    if not isinstance(value, list):
        return ()
    result: list[tuple[str, str | None]] = []
    for item in cast("list[Any]", value):
        if not isinstance(item, dict):
            continue
        item_map = cast("dict[str, Any]", item)
        node = item_map.get("node")
        if not isinstance(node, str):
            continue
        label = item_map.get("label")
        result.append((node, label if isinstance(label, str) else None))
    return tuple(result)


@dataclass(frozen=True, slots=True)
class Plan:
    """Top-level plan envelope.

    `raw` is the untouched `json.loads` output. Browser rendering serialises
    it directly (`json.dumps(plan.raw, ...)`) to guarantee bit-identical JSON
    output to the interactive HTML template. Nothing in the codebase mutates it.
    """

    resources: Mapping[ResourceKey, ResourceChange]
    raw: Mapping[str, object]
    plan_version: int | None = None
    cli_version: str | None = None
    lineage: str | None = None
    serial: int | None = None


def parse_plan(raw: str) -> Plan:
    """Parse a raw JSON string into a typed Plan."""
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise DagshundError(f"invalid JSON: {exc}") from exc
    except RecursionError as exc:
        raise DagshundError("plan JSON is too deeply nested") from exc

    if not isinstance(data, dict):
        raise DagshundError("plan JSON must be an object")

    return parse_plan_data(cast("dict[str, Any]", data))


def parse_plan_data(raw: Mapping[str, object]) -> Plan:
    """Build a Plan from an already-decoded mapping."""
    raw_resources = raw.get("plan")
    resources: dict[ResourceKey, ResourceChange] = {}
    if isinstance(raw_resources, dict):
        for k, v in cast("dict[str, Any]", raw_resources).items():
            if isinstance(k, str):
                resources[k] = parse_resource_change(k, v)

    return Plan(
        resources=resources,
        raw=raw,
        plan_version=_parse_optional_int(raw.get("plan_version")),
        cli_version=_parse_optional_str(raw.get("cli_version")),
        lineage=_parse_optional_str(raw.get("lineage")),
        serial=_parse_optional_int(raw.get("serial")),
    )


def _parse_optional_int(value: object) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) else None
