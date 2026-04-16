"""Plan parsing, change detection, and drift predicates."""

from collections.abc import Mapping

from dagshund.model import UNSET, ActionType, FieldChange, ResourceChange
from dagshund.types import DiffState, ResourceKey, parse_resource_key

__all__ = [
    "DANGEROUS_ACTIONS",
    "STATEFUL_RESOURCE_TYPES",
    "STATEFUL_RESOURCE_WARNINGS",
    "action_to_diff_state",
    "detect_changes",
    "detect_dangerous_actions",
    "detect_manual_edits",
    "has_drifted_field",
    "is_topology_drift_change",
]

DANGEROUS_ACTIONS: frozenset[ActionType] = frozenset({ActionType.DELETE, ActionType.RECREATE})

STATEFUL_RESOURCE_WARNINGS: dict[str, str] = {
    # Unity Catalog
    "catalogs": "all schemas, tables, and volumes in this catalog will be lost",
    "schemas": "all tables, views, and volumes in this schema will be lost",
    "volumes": "all files in this volume will be lost",
    "registered_models": "all model versions will be lost",
    "experiments": "all experiment runs and metrics will be lost",
    # PostgreSQL
    "database_instances": "all catalogs and tables on this instance will be lost",
    "postgres_projects": "all branches and endpoints in this project will be lost",
    "postgres_branches": "all data on this branch will be lost",
}

STATEFUL_RESOURCE_TYPES: frozenset[str] = frozenset(STATEFUL_RESOURCE_WARNINGS)


def action_to_diff_state(action: ActionType) -> DiffState:
    """Map an action to its diff state category.

    Action vocabulary is duplicated in two other locations:
    - format.py: ACTIONS dict (display config per action)
    - js/src/types/plan-schema.ts: knownActionTypes (Zod schema)
    """
    match action:
        case ActionType.CREATE:
            return DiffState.ADDED
        case ActionType.DELETE:
            return DiffState.REMOVED
        case ActionType.UPDATE | ActionType.RECREATE | ActionType.RESIZE | ActionType.UPDATE_ID:
            return DiffState.MODIFIED
        case ActionType.EMPTY | ActionType.SKIP:
            return DiffState.UNCHANGED
        case ActionType.UNKNOWN:
            return DiffState.UNKNOWN


def detect_changes(resources: Mapping[ResourceKey, ResourceChange]) -> bool:
    """Check whether any resource has a non-skip action (i.e., drift detected)."""
    return any(entry.action not in (ActionType.SKIP, ActionType.EMPTY) for entry in resources.values())


def has_drifted_field(change: FieldChange) -> bool:
    """Check whether a single field change represents manual drift.

    A field has drifted when old and new are both defined and equal (the bundle
    didn't intend to change it), and remote is present with a different value
    (someone edited the server state directly).
    """
    if action_to_diff_state(change.action) == DiffState.UNCHANGED:
        return False
    if change.old is UNSET or change.new is UNSET:
        return False
    if change.old != change.new:
        return False
    return change.remote is not UNSET and change.remote != change.old


def is_topology_drift_change(change: FieldChange) -> bool:
    """Check whether a change represents a sub-entity missing from the remote.

    Databricks encodes ``bundle has X, remote doesn't — bundle will recreate it``
    as ``action=update`` with ``old == new`` and no ``remote`` field. Operates on
    post-merge change keys (see ``merge.py``); callers live in ``format.py``.

    Direct mirror of the JS predicate at ``js/src/utils/structural-diff.ts``.
    Gated strictly on ``action=update`` — ``recreate``/``resize``/``update_id``
    never appear with this shape in observed plan.json output, and treating them
    as topology drift would render ``(re-added)`` under resources whose per-line
    action is already ``recreate``.

    Mutually exclusive with ``has_drifted_field`` by construction (that one
    requires ``remote`` to be set).
    """
    if change.action != ActionType.UPDATE:
        return False
    if change.old is UNSET or change.new is UNSET:
        return False
    if change.remote is not UNSET:
        return False
    return change.old == change.new


def detect_manual_edits(resources: Mapping[ResourceKey, ResourceChange]) -> bool:
    """Check whether any resource has fields that were manually edited outside the bundle."""
    return any(has_drifted_field(change) for entry in resources.values() for change in entry.changes.values())


def detect_dangerous_actions(resources: Mapping[ResourceKey, ResourceChange]) -> bool:
    """Check whether any stateful resource has a dangerous action (delete or recreate)."""
    return any(
        entry.action in DANGEROUS_ACTIONS and parse_resource_key(key)[0] in STATEFUL_RESOURCE_TYPES
        for key, entry in resources.items()
    )
