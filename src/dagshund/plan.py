from collections.abc import Mapping

from dagshund.change_path import FieldChangeContext, extract_list_element_semantic
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
    "resource_has_shape_drift",
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
    return any(entry.action not in (ActionType.SKIP, ActionType.EMPTY) for entry in resources.values())


def has_drifted_field(change: FieldChange, ctx: FieldChangeContext | None = None) -> bool:
    """Check whether a single field change represents manual drift.

    Two paths classify a change as drift:

    * **Shape-based** — ``old`` and ``new`` both defined and equal (the bundle
      did not intend to change it), and ``remote`` differs. Someone edited the
      server state directly.
    * **List-element reclassification** (``ctx`` with ``resource_has_shape_drift``) —
      a bundle-managed list-element entry that exists on the remote but not in
      ``new_state``. Gated on the enclosing resource also showing shape-based
      drift, because without ``old`` we cannot tell "bundle rewired this list"
      from "server was manually edited." Only reclassified *deletes* qualify.
    """
    if action_to_diff_state(change.action) == DiffState.UNCHANGED:
        return False
    if (
        change.old is not UNSET
        and change.new is not UNSET
        and change.old == change.new
        and change.remote is not UNSET
        and change.remote != change.old
    ):
        return True
    return ctx is not None and ctx.resource_has_shape_drift and extract_list_element_semantic(ctx) == "delete"


def resource_has_shape_drift(entry: ResourceChange) -> bool:
    """Whether any change in ``entry`` is shape-based drift (ignoring list-element reclassification)."""
    return any(has_drifted_field(change) for change in entry.changes.values())


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
    for entry in resources.values():
        shape_drift = resource_has_shape_drift(entry)
        for change_key, change in entry.changes.items():
            ctx = FieldChangeContext(
                change_key=change_key,
                new_state=entry.new_state,
                remote_state=entry.remote_state,
                resource_has_shape_drift=shape_drift,
            )
            if has_drifted_field(change, ctx):
                return True
    return False


def detect_dangerous_actions(resources: Mapping[ResourceKey, ResourceChange]) -> bool:
    return any(
        entry.action in DANGEROUS_ACTIONS and parse_resource_key(key)[0] in STATEFUL_RESOURCE_TYPES
        for key, entry in resources.items()
    )
