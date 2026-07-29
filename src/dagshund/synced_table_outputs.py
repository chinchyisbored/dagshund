from collections.abc import Mapping
from dataclasses import dataclass
from enum import StrEnum
from typing import cast

from dagshund.model import ResourceChange
from dagshund.types import ResourceKey, parse_resource_key


class OutputRelationship(StrEnum):
    MANAGED = "managed"
    REFERENCED = "referenced"


@dataclass(frozen=True, slots=True)
class SyncedTableOutput:
    relationship: OutputRelationship
    resource_type: str
    name: str


def _as_mapping(value: object) -> Mapping[str, object] | None:
    return cast("Mapping[str, object]", value) if isinstance(value, dict) else None


def _extract_resource_state(entry: ResourceChange) -> Mapping[str, object] | None:
    new_state = _as_mapping(entry.new_state)
    if new_state is not None and (value := _as_mapping(new_state.get("value"))) is not None:
        return value
    return _as_mapping(entry.remote_state)


def _extract_nested_string(state: Mapping[str, object], *path: str) -> str | None:
    current: object = state
    for segment in path:
        mapping = _as_mapping(current)
        if mapping is None:
            return None
        current = mapping.get(segment)
    if not isinstance(current, str) or not (normalized := current.strip()):
        return None
    return normalized


def _parse_three_part_name(name: str | None) -> tuple[str, str, str] | None:
    if name is None:
        return None
    parts = tuple(part.strip() for part in name.split("."))
    if len(parts) != 3 or not all(parts):
        return None
    return parts


def _extract_existing_pipeline_id(state: Mapping[str, object]) -> str | None:
    return _extract_nested_string(state, "existing_pipeline_id") or _extract_nested_string(
        state, "spec", "existing_pipeline_id"
    )


def _extract_pipeline_output(resource_name: str, state: Mapping[str, object]) -> SyncedTableOutput:
    existing_pipeline_id = _extract_existing_pipeline_id(state)
    if existing_pipeline_id is not None:
        return SyncedTableOutput(OutputRelationship.REFERENCED, "pipeline", existing_pipeline_id)
    return SyncedTableOutput(OutputRelationship.MANAGED, "pipeline", f"{resource_name} pipeline")


def _extract_postgres_synced_table_outputs(
    resource_name: str,
    state: Mapping[str, object],
) -> tuple[SyncedTableOutput, ...]:
    pipeline = _extract_pipeline_output(resource_name, state)
    synced_table_name = _parse_three_part_name(_extract_nested_string(state, "synced_table_id"))
    if synced_table_name is None:
        return (pipeline,)
    registration = SyncedTableOutput(
        OutputRelationship.MANAGED,
        "Unity Catalog registration",
        ".".join(synced_table_name),
    )
    return pipeline, registration


def _format_postgres_table_name(
    table_name: str,
    state: Mapping[str, object],
) -> str:
    instance = _extract_nested_string(state, "database_instance_name")
    database = _extract_nested_string(state, "logical_database_name")
    location = "/".join(part for part in (instance, database) if part is not None)
    return f"{table_name} ({location})" if location else table_name


def _extract_synced_database_table_outputs(
    resource_name: str,
    state: Mapping[str, object],
) -> tuple[SyncedTableOutput, ...]:
    pipeline = _extract_pipeline_output(resource_name, state)
    parsed_name = _parse_three_part_name(_extract_nested_string(state, "name"))
    if parsed_name is None:
        return (pipeline,)
    postgres_table = SyncedTableOutput(
        OutputRelationship.MANAGED,
        "PostgreSQL table",
        _format_postgres_table_name(parsed_name[2], state),
    )
    registration = SyncedTableOutput(
        OutputRelationship.MANAGED,
        "Unity Catalog registration",
        ".".join(parsed_name),
    )
    return pipeline, postgres_table, registration


def extract_synced_table_outputs(
    key: ResourceKey,
    entry: ResourceChange,
) -> tuple[SyncedTableOutput, ...]:
    resource_type, resource_name = parse_resource_key(key)
    if resource_type not in {"postgres_synced_tables", "synced_database_tables"}:
        return ()
    state = _extract_resource_state(entry) or {}
    match resource_type:
        case "postgres_synced_tables":
            return _extract_postgres_synced_table_outputs(resource_name, state)
        case "synced_database_tables":
            return _extract_synced_database_table_outputs(resource_name, state)
        case _:
            return ()
