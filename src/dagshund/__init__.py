"""Dagshund -- visualizer for databricks bundle plan output."""

import json
from typing import Any

__version__ = "0.1.0"

type ResourceChange = dict[str, Any]
type ResourceChangeMap = dict[str, ResourceChange]
type Plan = dict[str, Any]


class DagshundError(Exception):
    """Raised for any user-facing error (bad input, missing files, etc.)."""


def parse_plan(raw: str) -> Plan:
    """Parse and validate plan JSON."""
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise DagshundError(f"invalid JSON: {exc}") from exc

    if not isinstance(data, dict):
        raise DagshundError("plan JSON must be an object")

    return data
