"""Typed-dataclass factories for tests.

These keep test code readable: pass only the fields that matter, let the
factory fill in sensible defaults. All factories return frozen dataclasses
from `dagshund.model` — never dicts.
"""

from collections.abc import Mapping

from dagshund.model import (
    UNSET,
    ActionType,
    FieldChange,
    Plan,
    ResourceChange,
    parse_action,
    parse_field_change,
    parse_plan_data,
    parse_resource_change,
)
from dagshund.types import ResourceKey


def make_change(
    action: str | ActionType = "",
    *,
    reason: str | None = None,
    old: object = UNSET,
    new: object = UNSET,
    remote: object = UNSET,
) -> FieldChange:
    """Build a FieldChange with sparse defaults."""
    return FieldChange(
        action=action if isinstance(action, ActionType) else parse_action(action),
        reason=reason,
        old=old,
        new=new,
        remote=remote,
    )


def change_from_dict(raw: Mapping[str, object]) -> FieldChange:
    """Build a FieldChange from a dict literal (useful when migrating legacy tests)."""
    return parse_field_change(dict(raw))


def make_resource(
    key: ResourceKey = "resources.jobs.test",
    *,
    action: str | ActionType = "",
    depends_on: tuple[tuple[str, str | None], ...] = (),
    changes: Mapping[str, FieldChange] | None = None,
    new_state: object | None = None,
    remote_state: object | None = None,
) -> ResourceChange:
    """Build a ResourceChange with lenient defaults."""
    return ResourceChange(
        key=key,
        action=action if isinstance(action, ActionType) else parse_action(action),
        depends_on=depends_on,
        changes=dict(changes) if changes else {},
        new_state=new_state,
        remote_state=remote_state,
    )


def resource_from_dict(key: ResourceKey, raw: Mapping[str, object]) -> ResourceChange:
    """Parse a raw resource dict into a ResourceChange (legacy test migration helper)."""
    return parse_resource_change(key, dict(raw))


def resources_from_dict(
    raw: Mapping[ResourceKey, Mapping[str, object]],
) -> dict[ResourceKey, ResourceChange]:
    """Parse a dict of resource dicts into typed resources."""
    return {k: parse_resource_change(k, dict(v)) for k, v in raw.items()}


def make_plan(
    resources: Mapping[ResourceKey, ResourceChange] | None = None,
    *,
    raw: Mapping[str, object] | None = None,
    plan_version: int | None = None,
    cli_version: str | None = None,
    lineage: str | None = None,
    serial: int | None = None,
) -> Plan:
    """Build a Plan dataclass with typed resources."""
    return Plan(
        resources=dict(resources) if resources else {},
        raw=dict(raw) if raw else {},
        plan_version=plan_version,
        cli_version=cli_version,
        lineage=lineage,
        serial=serial,
    )


def plan_from_dict(raw: Mapping[str, object]) -> Plan:
    """Parse a raw plan dict into a typed Plan (for test fixtures written dict-first)."""
    return parse_plan_data(dict(raw))
