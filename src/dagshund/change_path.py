"""Path-walking helpers for change keys with bracket-filter segments (dagshund-1naj).

Shared by ``plan.py`` (drift detection) and ``format.py`` (field-action derivation).
Mirrors the TypeScript helper at ``js/src/utils/field-action.ts``; the shared
fixture at ``fixtures/list-element-semantic-cases.json`` protects the two from
drifting apart.
"""

import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Literal, cast


@dataclass(frozen=True, slots=True)
class FieldChangeContext:
    """Context passed alongside a ``FieldChange`` when the caller has the parent state.

    For change keys ending in a ``[field='value']`` bracket-filter, the CLI emits
    shapes that are structurally ambiguous with unrelated semantics (a
    remote-only list element reads like a field the bundle does not manage).
    Consulting the parent entry's ``new_state`` and ``remote_state`` lets us
    classify correctly.

    ``resource_has_shape_drift`` gates the list-element-delete → drift
    reclassification. Without an ``old`` value in the change entry we cannot
    distinguish "bundle rewired this list" from "server was manually edited."
    We only escalate to drift when the enclosing resource independently shows
    shape-based drift (``old == new != remote`` on some other field), which
    is the signal that we are looking at a drifted resource rather than a
    deliberate plan change.
    """

    change_key: str
    new_state: object | None
    remote_state: object | None
    resource_has_shape_drift: bool = False


ListElementSemantic = Literal["create", "delete", "update"]


# Sentinel for "element was not present (or not resolvable)". Distinct from
# the in-tree value being ``None`` (JSON null).
_MISSING: object = object()

# Trailing chain of ``[field='value']`` bracket filters. Requires ``=`` inside
# the brackets — distinguishes list-element filters (``[task_key='X']``) from
# dict-key brackets like ``properties['environment']``.
_TRAILING_LIST_FILTER_RE = re.compile(r"((?:\[[A-Za-z_][A-Za-z0-9_]*='[^']*'\])+)$")

# Individual bracket filter inside a group.
_BRACKET_FILTER_RE = re.compile(r"\[([A-Za-z_][A-Za-z0-9_]*)='([^']*)'\]")

# A path segment: optional identifier prefix followed by optional bracket filters.
_SEGMENT_RE = re.compile(r"^([A-Za-z_][A-Za-z0-9_]*)?((?:\[[^\[\]]+\])*)$")


def extract_list_element_semantic(ctx: FieldChangeContext) -> ListElementSemantic | None:
    """Classify a per-element list change by consulting parent state trees.

    Returns ``None`` when the change key does not end in a list-element
    bracket-filter (plain fields, dict-key brackets), when the trees are
    missing at the parent path, or when the element content is identical
    on both sides (noop — let upstream filters drop it).
    """
    trailing_match = _TRAILING_LIST_FILTER_RE.search(ctx.change_key)
    if trailing_match is None:
        return None

    filters = dict(_BRACKET_FILTER_RE.findall(trailing_match.group(1)))
    if not filters:
        return None
    parent_path = ctx.change_key[: trailing_match.start()].rstrip(".")

    new_elem = _resolve_list_element(_unwrap_new_state(ctx.new_state), parent_path, filters)
    remote_elem = _resolve_list_element(_unwrap_remote_state(ctx.remote_state), parent_path, filters)

    in_new = new_elem is not _MISSING
    in_remote = remote_elem is not _MISSING

    if in_remote and not in_new:
        return "delete"
    if in_new and not in_remote:
        return "create"
    if in_new and in_remote:
        return None if new_elem == remote_elem else "update"
    return None


def _unwrap_new_state(state: object | None) -> dict[str, object] | None:
    """``new_state`` is wrapped as ``{value: {...}, vars: {...}}`` by the CLI."""
    if not isinstance(state, dict):
        return None
    inner = cast("dict[str, object]", state).get("value")
    if isinstance(inner, dict):
        return cast("dict[str, object]", inner)
    return cast("dict[str, object]", state)


def _unwrap_remote_state(state: object | None) -> dict[str, object] | None:
    """``remote_state`` is the bare state dict (no wrapper)."""
    if not isinstance(state, dict):
        return None
    return cast("dict[str, object]", state)


def _resolve_list_element(
    root: dict[str, object] | None,
    parent_path: str,
    filters: Mapping[str, str],
) -> object:
    """Walk ``parent_path`` into ``root``, then find the list element matching ``filters``."""
    if root is None:
        return _MISSING

    current: object = root
    for segment in _split_segments(parent_path):
        current = _resolve_segment(current, segment)
        if current is None:
            return _MISSING

    if not isinstance(current, list):
        return _MISSING

    found = _find_in_list_by_filters(current, filters)
    return _MISSING if found is None else found


def _split_segments(path: str) -> list[str]:
    """Split ``path`` on ``.`` while respecting brackets (values may contain ``.``)."""
    if not path:
        return []
    segments: list[str] = []
    buf: list[str] = []
    depth = 0
    for ch in path:
        if ch == "[":
            depth += 1
            buf.append(ch)
        elif ch == "]":
            depth -= 1
            buf.append(ch)
        elif ch == "." and depth == 0:
            if buf:
                segments.append("".join(buf))
                buf = []
        else:
            buf.append(ch)
    if buf:
        segments.append("".join(buf))
    return segments


def _resolve_segment(current: object, segment: str) -> object | None:
    match = _SEGMENT_RE.match(segment)
    if match is None:
        return None
    prefix, brackets = match.group(1), match.group(2)

    if prefix:
        if not isinstance(current, dict):
            return None
        current = cast("dict[str, object]", current).get(prefix)

    if brackets:
        if not isinstance(current, list):
            return None
        filters = dict(_BRACKET_FILTER_RE.findall(brackets))
        current = _find_in_list_by_filters(current, filters)

    return current


def _find_in_list_by_filters(lst: Sequence[object], filters: Mapping[str, str]) -> object | None:
    for item in lst:
        if isinstance(item, dict) and all(str(cast("dict[str, object]", item).get(k)) == v for k, v in filters.items()):
            return item
    return None
