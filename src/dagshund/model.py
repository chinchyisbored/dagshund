"""Parse boundary: `Any` tax is paid once here, nowhere else.

Decoded inputs and nested JSON values are borrowed. Do not mutate them while a
plan, parsed resource, normalized mapping, or report is in use. Frozen dataclasses
prevent field reassignment, not mutation of nested values. The enclosing resource
mapping key is authoritative; ``ResourceChange.key`` retains parse-origin metadata.
Mirrors the TS schema at ``js/src/types/plan-schema.ts``.
"""

import json
from collections.abc import Mapping
from dataclasses import dataclass, field, replace
from enum import Enum, StrEnum
from typing import Any, cast

from dagshund.json_value import json_values_equal

# TODO: Once Python 3.15 is the minimum, load redaction only for plans with UC secrets,
# avoiding SecretComparisonFacts initialization for other plans.
from dagshund.redaction import SecretComparisonFacts, redact_uc_secret_values_with_facts
from dagshund.types import DagshundError, ResourceKey


class ActionType(StrEnum):
    """Mirrors ``knownActionTypes`` in ``js/src/types/plan-schema.ts``."""

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

    `old` / `new` / `remote` are borrowed opaque payloads: object for any JSON
    value, `None` when the key was present with JSON null, `UNSET` when absent.
    Frozen fields do not make nested payloads immutable; callers must not mutate
    shared values while a plan or report is in use. Presence versus null drives
    drift detection (`has_drifted_field`, `is_topology_drift_change`) and display.
    """

    action: ActionType = ActionType.EMPTY
    reason: str | None = None
    old: object | UnsetSentinel = UNSET
    new: object | UnsetSentinel = UNSET
    remote: object | UnsetSentinel = UNSET
    secret_facts: SecretComparisonFacts | None = None


def compare_field_values(change: FieldChange, left: str, right: str) -> bool | None:
    """Compare field payloads using safe secret facts when available."""
    facts = change.secret_facts
    if facts is not None:
        if (left, right) in (("old", "new"), ("new", "old")):
            return facts.old_new_equal
        if (left, right) in (("old", "remote"), ("remote", "old")):
            return facts.old_remote_equal
    left_value = getattr(change, left)
    right_value = getattr(change, right)
    if left_value is UNSET or right_value is UNSET:
        return None
    return json_values_equal(left_value, right_value)


def parse_field_change(
    raw: object, *, resource_key: ResourceKey | None = None, field_key: str | None = None
) -> FieldChange:
    """Signature is ``object`` so callers can pass unchecked JSON payloads."""
    if not isinstance(raw, dict):
        if resource_key is None or field_key is None:
            raise DagshundError("field change must be an object")
        raise DagshundError(
            f"change {_escape_identifier(field_key)} for resource {_escape_identifier(resource_key)} must be an object"
        )
    raw_map = cast("dict[str, Any]", raw)
    return FieldChange(
        action=parse_action(raw_map.get("action", "")),
        reason=_parse_optional_str(raw_map.get("reason")),
        old=raw_map.get("old", UNSET),
        new=raw_map.get("new", UNSET),
        remote=raw_map.get("remote", UNSET),
    )


def _escape_identifier(value: str) -> str:
    return json.dumps(value, ensure_ascii=True)


def _parse_optional_str(value: object) -> str | None:
    return value if isinstance(value, str) else None


@dataclass(frozen=True, slots=True)
class JobRunEffect:
    """A deploy-triggered run (``resources.job_runs.*``) folded onto its target job.

    Effects annotate the job without touching its action or diff state; only
    change detection (exit code, "No changes" gate) considers their actions.
    The raw borrowed states are retained for semantic outcome classification.
    Mirrors ``JobRunEffect`` in ``js/src/utils/normalize-plan.ts``.
    """

    name: str
    action: ActionType = ActionType.EMPTY
    changes: Mapping[str, FieldChange] = field(default_factory=dict)
    run_page_url: str | None = None
    new_state: object | None = None
    remote_state: object | None = None


@dataclass(frozen=True, slots=True)
class ResourceChange:
    """Resource data with borrowed state/change payloads.

    ``key`` records the key used during parsing. Consumers use the enclosing
    resource mapping key as authoritative identity, even if callers rekey a
    mapping or construct an entry with a different ``key``.
    """

    key: ResourceKey
    action: ActionType = ActionType.EMPTY
    depends_on: tuple[tuple[str, str | None], ...] = ()
    changes: Mapping[str, FieldChange] = field(default_factory=dict)
    new_state: object | None = None
    remote_state: object | None = None
    effects: tuple[JobRunEffect, ...] = ()


def parse_resource_change(key: ResourceKey, raw: object) -> ResourceChange:
    if not isinstance(raw, dict):
        raise DagshundError(f"resource {_escape_identifier(key)} must be an object")
    raw_map = cast("dict[str, Any]", raw)
    raw_changes = raw_map.get("changes")
    changes: dict[str, FieldChange] = {}
    if raw_changes is not None and not isinstance(raw_changes, dict):
        raise DagshundError(f"changes for resource {_escape_identifier(key)} must be an object or null")
    if isinstance(raw_changes, dict):
        for k, v in cast("dict[object, object]", raw_changes).items():
            if isinstance(k, str):
                changes[k] = parse_field_change(v, resource_key=key, field_key=k)

    return ResourceChange(
        key=key,
        action=parse_action(raw_map.get("action", "")),
        depends_on=_parse_depends_on(raw_map.get("depends_on")),
        changes=changes,
        new_state=raw_map.get("new_state"),
        remote_state=raw_map.get("remote_state"),
    )


def _parse_depends_on(value: object) -> tuple[tuple[str, str | None], ...]:
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
    """Parsed plan envelope, never a container for normalized resources.

    `resources` contains the parsed, redacted entries before sub-resource merging
    or effect folding. Callers normalize it separately for Python reporting.
    `raw` preserves the original parsed input after UC secret values are redacted,
    including entries later absorbed by normalization. Browser rendering serialises
    it directly. It is not the exact source bytes used for provenance hashing.
    Neither mapping is mutated during normalization or rendering.
    """

    resources: Mapping[ResourceKey, ResourceChange]
    raw: Mapping[str, object]
    plan_version: int | None = None
    cli_version: str | None = None
    lineage: str | None = None
    serial: int | None = None


def parse_plan(raw: str) -> Plan:
    """Parse and redact JSON without normalizing its resource entries."""
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
    """Parse a borrowed decoded payload, redacting secrets without mutating input.

    With no redaction needed, ``raw`` may be the original mapping by identity.
    Redaction copies affected branches only. Parsed state/change values remain
    borrowed; callers must not mutate shared input or nested payloads while in use.
    Parsed resource keys match their enclosing mapping keys.
    """
    raw, secret_facts = redact_uc_secret_values_with_facts(raw)
    raw_resources = raw.get("plan")
    resources: dict[ResourceKey, ResourceChange] = {}
    if isinstance(raw_resources, dict):
        for k, v in cast("dict[object, object]", raw_resources).items():
            if isinstance(k, str):
                resource = parse_resource_change(k, v)
                changes = {
                    field_key: replace(change, secret_facts=facts)
                    if (facts := secret_facts.get((k, field_key))) is not None
                    else change
                    for field_key, change in resource.changes.items()
                }
                resources[k] = replace(resource, changes=changes)

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
