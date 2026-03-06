"""Search DSL for filtering plan resources.

Grammar matches the browser search DSL (js/src/utils/search-query-parser.ts):
  type:X       — substring match against resource type (e.g. type:jobs)
  status:X     — exact match against diff state (added/modified/removed/unchanged)
  "exact"      — exact match against resource name
  bare words   — substring match against resource name

All tokens AND together.
"""

import re
from collections.abc import Callable
from dataclasses import dataclass

from dagshund import ResourceChange, ResourceKey, action_to_diff_state, parse_resource_key


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
class _FuzzyToken:
    value: str


type _SearchToken = _TypeToken | _StatusToken | _ExactToken | _FuzzyToken


def _tokenize(query: str) -> list[str]:
    """Split query into raw tokens, respecting quoted phrases."""
    return re.findall(r'"[^"]*"|\S+', query)


def _classify_token(raw: str) -> _SearchToken | None:
    """Classify a raw token string into a typed search token, or None to drop it."""
    if raw.startswith('"') and raw.endswith('"') and len(raw) > 2:
        return _ExactToken(value=raw[1:-1])
    if raw.startswith("type:"):
        value = raw[5:]
        return _TypeToken(value=value) if value else None
    if raw.startswith("status:"):
        value = raw[7:]
        return _StatusToken(value=value) if value else None
    return _FuzzyToken(value=raw)


def _parse_filter_query(query: str) -> list[_SearchToken]:
    """Parse a filter query string into structured search tokens."""
    lowered = query.lower().strip()
    return [token for raw in _tokenize(lowered) if (token := _classify_token(raw)) is not None]


def _match_token(token: _SearchToken, key: ResourceKey, entry: ResourceChange) -> bool:
    """Test whether a single token matches a resource entry."""
    resource_type, resource_name = parse_resource_key(key)
    match token:
        case _TypeToken(value=value):
            return value in resource_type.lower()
        case _StatusToken(value=value):
            return action_to_diff_state(entry.get("action", "")).value == value
        case _ExactToken(value=value):
            return resource_name.lower() == value
        case _FuzzyToken(value=value):
            return value in resource_name.lower()


def build_query_predicate(query: str) -> Callable[[ResourceKey, ResourceChange], bool] | None:
    """Build a predicate from a filter DSL query string.

    Returns None if the query produces no tokens.
    """
    tokens = _parse_filter_query(query)
    if not tokens:
        return None

    def match_all(key: ResourceKey, entry: ResourceChange) -> bool:
        return all(_match_token(t, key, entry) for t in tokens)

    return match_all
