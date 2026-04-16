"""Search DSL for filtering plan resources.

Grammar extends the browser search DSL (js/src/utils/search-query-parser.ts):
  type:X       — substring match against resource type (e.g. type:jobs)
  status:X     — exact match against diff state (added/modified/removed/unchanged)
  field:X      — substring match against field change keys (e.g. field:email)
  "exact"      — exact match against resource name
  bare words   — substring match against resource name

All tokens AND together.
"""

import re
from collections.abc import Callable
from dataclasses import dataclass

from dagshund.model import ResourceChange
from dagshund.plan import action_to_diff_state
from dagshund.types import ResourceKey, parse_resource_key


@dataclass(frozen=True, slots=True)
class _TypeToken:
    value: str


@dataclass(frozen=True, slots=True)
class _StatusToken:
    value: str


@dataclass(frozen=True, slots=True)
class _ExactToken:
    value: str


@dataclass(frozen=True, slots=True)
class _FieldToken:
    value: str


@dataclass(frozen=True, slots=True)
class _FuzzyToken:
    value: str


type _SearchToken = _TypeToken | _StatusToken | _FieldToken | _ExactToken | _FuzzyToken


def _tokenize(query: str) -> list[str]:
    return re.findall(r'"[^"]*"|\S+', query)


def _classify_token(raw: str) -> _SearchToken | None:
    if raw.startswith('"') and raw.endswith('"') and len(raw) > 2:
        return _ExactToken(value=raw[1:-1])
    if raw.startswith("type:"):
        value = raw[5:]
        return _TypeToken(value=value) if value else None
    if raw.startswith("status:"):
        value = raw[7:]
        return _StatusToken(value=value) if value else None
    if raw.startswith("field:"):
        value = raw[6:]
        return _FieldToken(value=value) if value else None
    return _FuzzyToken(value=raw)


def _parse_filter_query(query: str) -> list[_SearchToken]:
    lowered = query.lower().strip()
    return [token for raw in _tokenize(lowered) if (token := _classify_token(raw)) is not None]


def _has_matching_field_key(value: str, entry: ResourceChange) -> bool:
    return any(value in field_key.lower() for field_key in entry.changes)


def _match_token(token: _SearchToken, key: ResourceKey, entry: ResourceChange) -> bool:
    resource_type, resource_name = parse_resource_key(key)
    match token:
        case _TypeToken(value=value):
            return value in resource_type.lower()
        case _StatusToken(value=value):
            return action_to_diff_state(entry.action).value == value
        case _FieldToken(value=value):
            return _has_matching_field_key(value, entry)
        case _ExactToken(value=value):
            return resource_name.lower() == value
        case _FuzzyToken(value=value):
            return value in resource_name.lower()


def build_query_predicate(query: str) -> Callable[[ResourceKey, ResourceChange], bool] | None:
    """Returns None if the query produces no usable tokens."""
    tokens = _parse_filter_query(query)
    if not tokens:
        return None

    def match_all(key: ResourceKey, entry: ResourceChange) -> bool:
        return all(_match_token(t, key, entry) for t in tokens)

    return match_all
