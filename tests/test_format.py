"""Direct unit tests for format.py functions."""

import pytest
from factories import make_change, make_resource, resources_from_dict

from dagshund.format import (
    ACTIONS,
    DEFAULT_ACTION,
    ActionConfig,
    DriftSummary,
    _extract_drift_label_noun,
    _singularize,
    _summarize_resource_drift,
    action_config,
    collect_drift_summaries,
    collect_warnings,
    count_by_action,
    detect_drift_fields,
    detect_drift_reentries,
    field_action_config,
    filter_resources,
    format_display_value,
    format_drift_subline_body,
    format_field_suffix,
    format_group_header,
    format_transition,
    format_value,
    group_by_resource_type,
    is_long_string,
    iter_non_topology_field_changes,
)
from dagshund.model import ActionType
from dagshund.plan import DANGEROUS_ACTIONS, STATEFUL_RESOURCE_TYPES, action_to_diff_state
from dagshund.types import DiffState, parse_resource_key

# --- field_action_config ---


def test_field_action_config_new_only_returns_create() -> None:
    result = field_action_config(make_change(action="update", new="val"))

    assert result.display == "create"
    assert result.symbol == "+"


def test_field_action_config_old_only_returns_delete() -> None:
    result = field_action_config(make_change(action="update", old="val"))

    assert result.display == "delete"
    assert result.symbol == "-"


def test_field_action_config_both_old_and_new_returns_base() -> None:
    result = field_action_config(make_change(action="update", old="a", new="b"))

    assert result.display == "update"
    assert result.show_field_changes is True


def test_field_action_config_remote_only_returns_remote() -> None:
    result = field_action_config(make_change(action="update", remote="val"))

    assert result.display == "remote"
    assert result.symbol == "="


def test_field_action_config_non_field_action_passes_through() -> None:
    result = field_action_config(make_change(action="create", new="val"))

    assert result.display == "create"
    assert result.symbol == "+"


def test_field_action_config_unknown_action_returns_default() -> None:
    result = field_action_config(make_change(action="bogus"))

    assert result.display == "unknown"
    assert result.symbol == "?"


# --- field_action_config with FieldChangeContext (list-element reclassification, dagshund-1naj) ---


def test_field_action_config_list_element_delete_reclassified() -> None:
    from dagshund.change_path import FieldChangeContext

    ctx = FieldChangeContext(
        change_key="depends_on[task_key='ingest']",
        new_state={"depends_on": []},
        remote_state={"depends_on": [{"task_key": "ingest"}]},
    )
    result = field_action_config(make_change(action="update", remote={"task_key": "ingest"}), ctx)
    assert result.display == "delete"
    assert result.symbol == "-"


def test_field_action_config_list_element_create_reclassified() -> None:
    from dagshund.change_path import FieldChangeContext

    ctx = FieldChangeContext(
        change_key="depends_on[task_key='transform']",
        new_state={"depends_on": [{"task_key": "transform"}]},
        remote_state={"depends_on": []},
    )
    result = field_action_config(make_change(action="update", new={"task_key": "transform"}), ctx)
    assert result.display == "create"
    assert result.symbol == "+"


def test_field_action_config_non_list_element_path_falls_back_to_shape() -> None:
    from dagshund.change_path import FieldChangeContext

    ctx = FieldChangeContext(
        change_key="edit_mode",
        new_state={"edit_mode": "UI_LOCKED"},
        remote_state={"edit_mode": "EDITABLE"},
    )
    result = field_action_config(make_change(action="update", remote="EDITABLE"), ctx)
    # Remote-only shape → remote badge (shape-based fallback — ctx didn't match a list element)
    assert result.display == "remote"


# --- format_field_suffix ---


def test_format_field_suffix_drift_shows_remote_to_new() -> None:
    result = format_field_suffix(make_change(old="val", new="val", remote="drifted"))

    assert result == ': "drifted" -> "val" (drift)'


def test_format_field_suffix_noop_returns_none() -> None:
    result = format_field_suffix(make_change(old="same", new="same"))

    assert result is None


def test_format_field_suffix_remote_only() -> None:
    result = format_field_suffix(make_change(remote="server_val"))

    assert result == ': "server_val" (remote)'


def test_format_field_suffix_transition() -> None:
    result = format_field_suffix(make_change(old="before", new="after"))

    assert result == ': "before" -> "after"'


def test_format_field_suffix_new_only() -> None:
    result = format_field_suffix(make_change(new="added_val"))

    assert result == ': "added_val"'


def test_format_field_suffix_old_only() -> None:
    result = format_field_suffix(make_change(old="removed_val"))

    assert result == ': "removed_val"'


def test_format_field_suffix_no_values_returns_empty() -> None:
    result = format_field_suffix(make_change())

    assert result == ""


# --- format_field_suffix with FieldChangeContext (list-element reclassification, dagshund-1naj) ---


def test_format_field_suffix_list_element_delete_with_shape_drift_tags_drift() -> None:
    from dagshund.change_path import FieldChangeContext

    ctx = FieldChangeContext(
        change_key="depends_on[task_key='ingest']",
        new_state={"depends_on": []},
        remote_state={"depends_on": [{"task_key": "ingest"}]},
        resource_has_shape_drift=True,
    )
    result = format_field_suffix(make_change(action="update", remote={"task_key": "ingest"}), ctx)
    assert result == ': {task_key: "ingest"} (drift)'


def test_format_field_suffix_list_element_delete_without_shape_drift_no_tag() -> None:
    from dagshund.change_path import FieldChangeContext

    ctx = FieldChangeContext(
        change_key="depends_on[task_key='ingest']",
        new_state={"depends_on": []},
        remote_state={"depends_on": [{"task_key": "ingest"}]},
        resource_has_shape_drift=False,
    )
    result = format_field_suffix(make_change(action="update", remote={"task_key": "ingest"}), ctx)
    assert result == ': {task_key: "ingest"}'


def test_format_field_suffix_list_element_create_uses_new_value() -> None:
    from dagshund.change_path import FieldChangeContext

    ctx = FieldChangeContext(
        change_key="depends_on[task_key='transform']",
        new_state={"depends_on": [{"task_key": "transform"}]},
        remote_state={"depends_on": []},
    )
    result = format_field_suffix(make_change(action="update", new={"task_key": "transform"}), ctx)
    assert result == ': {task_key: "transform"}'


# --- format_display_value ---


def test_format_display_value_small_list_inline() -> None:
    assert format_display_value([1, 2, 3]) == "[1, 2, 3]"


def test_format_display_value_large_list_summarized() -> None:
    assert format_display_value(list(range(30))) == "[30 items]"


def test_format_display_value_large_dict_summarized() -> None:
    big_dict = {f"key_{i}": f"value_{i}" for i in range(20)}

    assert format_display_value(big_dict) == "{20 fields}"


def test_format_field_suffix_transition_collapses_large_lists() -> None:
    old = [{"task_key": f"t{i}"} for i in range(5)]
    new = [{"task_key": f"t{i}"} for i in range(8)]

    result = format_field_suffix(make_change(old=old, new=new))

    assert result == ": [5 items] -> [8 items]"


# --- format_transition ---


def test_format_transition_collapses_each_side_independently() -> None:
    # Asymmetric collapse is intentional: the short side keeps context,
    # the long side summarizes. Locks in the design decision from dagshund-an5c.
    short_old = [{"task_key": "check_nulls"}]
    long_new = [{"task_key": f"t{i}"} for i in range(8)]

    result = format_transition(short_old, long_new)

    assert result == ': [{task_key: "check_nulls"}] -> [8 items]'


# --- format_drift_subline_body ---


def test_format_drift_subline_body_singular() -> None:
    result = format_drift_subline_body(1, "task", "re-added", "transform")

    assert result == "1 task will be re-added (transform)"


def test_format_drift_subline_body_plural() -> None:
    result = format_drift_subline_body(3, "task", "re-added", "a, b, c")

    assert result == "3 tasks will be re-added (a, b, c)"


def test_format_drift_subline_body_no_labels() -> None:
    result = format_drift_subline_body(2, "grant", "re-added")

    assert result == "2 grants will be re-added"


# --- _singularize ---


@pytest.mark.parametrize(
    ("plural", "expected"),
    [
        ("tasks", "task"),
        ("grants", "grant"),
        ("libraries", "library"),
        ("entries", "entry"),
        ("class", "class"),
        ("boss", "boss"),
        ("x", "x"),
    ],
    ids=["s-suffix", "s-suffix-2", "ies-suffix", "ies-suffix-2", "ss-preserved", "ss-preserved-2", "no-change"],
)
def test_singularize(plural: str, expected: str) -> None:
    assert _singularize(plural) == expected


# --- action_config ---


@pytest.mark.parametrize(
    ("action", "expected"),
    [
        (ActionType.CREATE, ActionConfig("create", "+")),
        (ActionType.DELETE, ActionConfig("delete", "-")),
        (ActionType.UPDATE, ActionConfig("update", "~", show_field_changes=True)),
        (ActionType.RECREATE, ActionConfig("recreate", "~", show_field_changes=True)),
        (ActionType.RESIZE, ActionConfig("resize", "~", show_field_changes=True)),
        (ActionType.UPDATE_ID, ActionConfig("update_id", "~", show_field_changes=True)),
        (ActionType.SKIP, ActionConfig("unchanged", "=")),
        (ActionType.EMPTY, ActionConfig("unchanged", "=")),
        (ActionType.UNKNOWN, DEFAULT_ACTION),
    ],
    ids=[
        "create",
        "delete",
        "update",
        "recreate",
        "resize",
        "update_id",
        "skip",
        "empty",
        "unknown",
    ],
)
def test_action_config(action: ActionType, expected: ActionConfig) -> None:
    assert action_config(action) == expected


def test_actions_table_covers_all_update_actions() -> None:
    update_configs = [cfg for cfg in ACTIONS.values() if cfg.show_field_changes]
    assert len(update_configs) == 4


# --- parse_resource_key ---


@pytest.mark.parametrize(
    ("key", "expected"),
    [
        ("resources.jobs.etl_pipeline", ("jobs", "etl_pipeline")),
        ("resources.jobs.pipeline.extra", ("jobs", "pipeline.extra")),
        ("jobs.etl_pipeline", ("jobs", "etl_pipeline")),
        ("standalone", ("", "standalone")),
        ("", ("", "")),
    ],
    ids=["three_parts", "dotted_name", "two_parts", "one_part", "empty_string"],
)
def test_parse_resource_key(key: str, expected: tuple[str, str]) -> None:
    assert parse_resource_key(key) == expected


# --- format_value ---


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (None, "null"),
        ("hello", '"hello"'),
        (True, "true"),
        (False, "false"),
        (42, "42"),
        (3.14, "3.14"),
        ({"a": 1, "b": 2}, "{a: 1, b: 2}"),
        ({}, "{}"),
        ([1, 2, 3], "[1, 2, 3]"),
        ([], "[]"),
    ],
    ids=["none", "string", "true", "false", "int", "float", "dict", "empty_dict", "list", "empty_list"],
)
def test_format_value(value: object, expected: str) -> None:
    assert format_value(value) == expected


def test_format_value_long_string_not_truncated() -> None:
    """format_value no longer truncates — is_long_string guards in the caller instead."""
    result = format_value("a" * 100)

    assert result == f'"{"a" * 100}"'


def test_format_value_unknown_type_uses_repr() -> None:
    result = format_value(object())
    assert result.startswith("<")


# --- format_transition (large-collection collapse) ---


def test_format_transition_large_dict_collapses_both_sides() -> None:
    big = {"a": "x" * 30, "b": "y" * 30}

    result = format_transition(big, big)

    assert result == ": {2 fields} -> {2 fields}"


# --- is_long_string ---


def test_is_long_string_boundary_40_not_long() -> None:
    assert is_long_string("a" * 40) is False


def test_is_long_string_boundary_41_is_long() -> None:
    assert is_long_string("a" * 41) is True


def test_is_long_string_empty_string() -> None:
    assert is_long_string("") is False


def test_is_long_string_non_string_types() -> None:
    assert is_long_string(None) is False
    assert is_long_string(42) is False
    assert is_long_string(True) is False
    assert is_long_string({"key": "value"}) is False
    assert is_long_string([1, 2, 3]) is False


# --- count_by_action ---


def test_count_by_action_mixed() -> None:
    entries = resources_from_dict(
        {
            "a": {"action": "create"},
            "b": {"action": "create"},
            "c": {"action": "delete"},
            "d": {"action": "update"},
        }
    )

    assert count_by_action(entries) == {
        action_config(ActionType.CREATE): 2,
        action_config(ActionType.DELETE): 1,
        action_config(ActionType.UPDATE): 1,
    }


def test_count_by_action_skip_becomes_unchanged() -> None:
    entries = resources_from_dict({"a": {"action": "skip"}, "b": {"action": "skip"}})
    assert count_by_action(entries) == {action_config(ActionType.SKIP): 2}


def test_count_by_action_empty_becomes_unchanged() -> None:
    entries = resources_from_dict({"a": {"action": ""}, "b": {}})
    assert count_by_action(entries) == {action_config(ActionType.EMPTY): 2}


def test_count_by_action_empty_input() -> None:
    assert count_by_action({}) == {}


# --- group_by_resource_type ---


def test_group_by_resource_type_groups_correctly() -> None:
    plan = resources_from_dict(
        {
            "resources.jobs.a": {"action": "create"},
            "resources.jobs.b": {"action": "delete"},
            "resources.schemas.c": {"action": "update"},
        }
    )

    result = group_by_resource_type(plan)

    assert set(result.keys()) == {"jobs", "schemas"}
    assert len(result["jobs"]) == 2
    assert len(result["schemas"]) == 1


def test_group_by_resource_type_empty_plan() -> None:
    assert group_by_resource_type({}) == {}


# --- action_to_diff_state ---


@pytest.mark.parametrize(
    ("action", "expected"),
    [
        (ActionType.CREATE, DiffState.ADDED),
        (ActionType.DELETE, DiffState.REMOVED),
        (ActionType.UPDATE, DiffState.MODIFIED),
        (ActionType.RECREATE, DiffState.MODIFIED),
        (ActionType.RESIZE, DiffState.MODIFIED),
        (ActionType.UPDATE_ID, DiffState.MODIFIED),
        (ActionType.SKIP, DiffState.UNCHANGED),
        (ActionType.EMPTY, DiffState.UNCHANGED),
        (ActionType.UNKNOWN, DiffState.UNKNOWN),
    ],
    ids=["create", "delete", "update", "recreate", "resize", "update_id", "skip", "empty", "unknown"],
)
def test_action_to_diff_state(action: ActionType, expected: DiffState) -> None:
    assert action_to_diff_state(action) == expected


def test_all_diff_states_reachable_from_actions() -> None:
    """Every defined diff state except UNKNOWN must be reachable from a known action."""
    reachable = {action_to_diff_state(action) for action in ACTIONS}
    assert reachable == set(DiffState) - {DiffState.UNKNOWN}


# --- filter_resources ---


def test_filter_resources_by_state_keeps_matching() -> None:
    entries = resources_from_dict(
        {
            "resources.jobs.a": {"action": "create"},
            "resources.jobs.b": {"action": "skip"},
            "resources.jobs.c": {"action": "delete"},
        }
    )

    result = filter_resources(entries, visible_states=frozenset({DiffState.ADDED}))

    assert list(result.keys()) == ["resources.jobs.a"]


def test_filter_resources_by_state_multiple_states() -> None:
    entries = resources_from_dict(
        {
            "resources.jobs.a": {"action": "create"},
            "resources.jobs.b": {"action": "delete"},
            "resources.jobs.c": {"action": "skip"},
        }
    )

    result = filter_resources(entries, visible_states=frozenset({DiffState.ADDED, DiffState.REMOVED}))

    assert set(result.keys()) == {"resources.jobs.a", "resources.jobs.b"}


def test_filter_resources_by_state_returns_empty_when_none_match() -> None:
    entries = resources_from_dict({"resources.jobs.a": {"action": "skip"}})

    result = filter_resources(entries, visible_states=frozenset({DiffState.ADDED}))

    assert result == {}


def test_filter_resources_by_state_modified_includes_all_update_actions() -> None:
    entries = resources_from_dict(
        {
            "resources.jobs.a": {"action": "update"},
            "resources.jobs.b": {"action": "recreate"},
            "resources.jobs.c": {"action": "resize"},
            "resources.jobs.d": {"action": "update_id"},
            "resources.jobs.e": {"action": "skip"},
        }
    )

    result = filter_resources(entries, visible_states=frozenset({DiffState.MODIFIED}))

    assert len(result) == 4
    assert "resources.jobs.e" not in result


def test_filter_resources_by_predicate_keeps_matching() -> None:
    entries = resources_from_dict(
        {
            "resources.jobs.a": {"action": "create"},
            "resources.jobs.b": {"action": "skip"},
        }
    )

    result = filter_resources(entries, resource_filter=lambda k, _v: "jobs.a" in k)

    assert list(result.keys()) == ["resources.jobs.a"]


def test_filter_resources_both_filters_compose_as_and() -> None:
    entries = resources_from_dict(
        {
            "resources.jobs.a": {"action": "create"},
            "resources.jobs.b": {"action": "create"},
            "resources.jobs.c": {"action": "skip"},
        }
    )

    result = filter_resources(
        entries,
        visible_states=frozenset({DiffState.ADDED}),
        resource_filter=lambda k, _v: "jobs.b" in k,
    )

    assert list(result.keys()) == ["resources.jobs.b"]


# --- format_group_header ---


def test_format_group_header_all_visible() -> None:
    assert format_group_header("jobs", 3, 3) == "jobs (3)"


def test_format_group_header_partial_visible() -> None:
    assert format_group_header("experiments", 3, 1) == "experiments (1/3)"


# --- collect_warnings ---


def test_collect_warnings_detects_stateful_delete() -> None:
    resources = resources_from_dict({"resources.volumes.imports": {"action": "delete"}})

    warnings = collect_warnings(resources)

    assert len(warnings) == 1
    assert "volumes/imports" in warnings[0]
    assert "deleted" in warnings[0]
    assert "all files in this volume will be lost" in warnings[0]


def test_collect_warnings_detects_stateful_recreate() -> None:
    resources = resources_from_dict({"resources.schemas.analytics": {"action": "recreate"}})

    warnings = collect_warnings(resources)

    assert len(warnings) == 1
    assert "schemas/analytics" in warnings[0]
    assert "recreated" in warnings[0]
    assert "all tables, views, and volumes in this schema will be lost" in warnings[0]


def test_collect_warnings_ignores_non_stateful_delete() -> None:
    resources = resources_from_dict({"resources.jobs.etl": {"action": "delete"}})

    assert collect_warnings(resources) == []


def test_collect_warnings_ignores_stateful_update() -> None:
    resources = resources_from_dict({"resources.schemas.analytics": {"action": "update"}})

    assert collect_warnings(resources) == []


def test_collect_warnings_ignores_stateful_skip() -> None:
    resources = resources_from_dict({"resources.volumes.data": {"action": "skip"}})

    assert collect_warnings(resources) == []


@pytest.mark.parametrize(
    ("resource_type", "expected_risk"),
    [
        ("catalogs", "all schemas, tables, and volumes in this catalog"),
        ("schemas", "all tables, views, and volumes in this schema"),
        ("volumes", "all files in this volume"),
        ("registered_models", "all model versions"),
        ("experiments", "all experiment runs and metrics"),
        ("database_instances", "all catalogs and tables on this instance"),
        ("postgres_projects", "all branches and endpoints in this project"),
        ("postgres_branches", "all data on this branch"),
    ],
    ids=[
        "catalogs",
        "schemas",
        "volumes",
        "registered_models",
        "experiments",
        "database_instances",
        "postgres_projects",
        "postgres_branches",
    ],
)
def test_collect_warnings_all_stateful_types(resource_type: str, expected_risk: str) -> None:
    resources = resources_from_dict({f"resources.{resource_type}.x": {"action": "delete"}})

    warnings = collect_warnings(resources)

    assert len(warnings) == 1
    assert expected_risk in warnings[0]


def test_collect_warnings_respects_visible_states_filter() -> None:
    resources = resources_from_dict(
        {
            "resources.volumes.imports": {"action": "delete"},
            "resources.schemas.analytics": {"action": "recreate"},
        }
    )

    warnings = collect_warnings(resources, visible_states=frozenset({DiffState.REMOVED}))

    assert len(warnings) == 1
    assert "volumes/imports" in warnings[0]


def test_collect_warnings_empty_when_filtered_out() -> None:
    resources = resources_from_dict({"resources.volumes.imports": {"action": "delete"}})

    assert collect_warnings(resources, visible_states=frozenset({DiffState.ADDED})) == []


def test_collect_warnings_multiple_sorted_by_key() -> None:
    resources = resources_from_dict(
        {
            "resources.volumes.z_data": {"action": "delete"},
            "resources.catalogs.a_main": {"action": "delete"},
        }
    )

    warnings = collect_warnings(resources)

    assert len(warnings) == 2
    assert "catalogs/a_main" in warnings[0]
    assert "volumes/z_data" in warnings[1]


def test_collect_warnings_covers_all_dangerous_actions() -> None:
    """Every action in DANGEROUS_ACTIONS must trigger a warning on a stateful resource."""
    for action in DANGEROUS_ACTIONS:
        resources = resources_from_dict({"resources.schemas.test": {"action": action}})
        assert collect_warnings(resources), f"action '{action}' should produce a warning"


def test_collect_warnings_covers_all_stateful_types() -> None:
    """Every type in STATEFUL_RESOURCE_TYPES must trigger a warning on delete."""
    for resource_type in STATEFUL_RESOURCE_TYPES:
        resources = resources_from_dict({f"resources.{resource_type}.test": {"action": "delete"}})
        assert collect_warnings(resources), f"resource type '{resource_type}' should produce a warning"


# --- detect_drift_fields ---


def test_detect_drift_fields_returns_empty_for_no_changes() -> None:
    assert detect_drift_fields({}) == []


def test_detect_drift_fields_returns_empty_when_old_differs_from_new() -> None:
    changes = {"field": make_change(action="update", old="a", new="b", remote="c")}
    assert detect_drift_fields(changes) == []


def test_detect_drift_fields_returns_empty_when_old_equals_remote() -> None:
    changes = {"field": make_change(action="update", old="a", new="a", remote="a")}
    assert detect_drift_fields(changes) == []


def test_detect_drift_fields_detects_remote_differs_from_old() -> None:
    changes = {"edit_mode": make_change(action="update", old="UI_LOCKED", new="UI_LOCKED", remote="EDITABLE")}
    assert detect_drift_fields(changes) == ["edit_mode"]


def test_detect_drift_fields_remote_absent_not_drift() -> None:
    changes = {"task": make_change(action="update", old={"task_key": "x"}, new={"task_key": "x"})}
    assert detect_drift_fields(changes) == []


def test_detect_drift_fields_skips_skip_action() -> None:
    changes = {"field": make_change(action="skip", old="a", new="a", remote="b")}
    assert detect_drift_fields(changes) == []


def test_detect_drift_fields_skips_empty_action() -> None:
    changes = {"field": make_change(action="", old="a", new="a", remote="b")}
    assert detect_drift_fields(changes) == []


def test_detect_drift_fields_skips_entries_without_old() -> None:
    changes = {"field": make_change(action="update", new="a", remote="b")}
    assert detect_drift_fields(changes) == []


def test_detect_drift_fields_skips_entries_without_new() -> None:
    changes = {"field": make_change(action="update", old="a", remote="b")}
    assert detect_drift_fields(changes) == []


def test_detect_drift_fields_returns_multiple_sorted() -> None:
    changes = {
        "z_field": make_change(action="update", old=1, new=1, remote=2),
        "a_field": make_change(action="update", old="x", new="x", remote="y"),
    }
    assert detect_drift_fields(changes) == ["a_field", "z_field"]


# --- _extract_drift_label_noun ---


@pytest.mark.parametrize(
    ("key", "expected"),
    [
        ("tasks[task_key='transform']", ("task", "transform")),
        ("grants.[principal='data_engineers']", ("grant", "data_engineers")),
        ("libraries[name='foo']", ("library", "foo")),
        ("job_clusters[job_cluster_key='main']", ("job_cluster", "main")),
        ("permissions[user_name='alice']", ("permission", "alice")),
        ("parameters[name='x']", ("parameter", "x")),
        ("environments[environment_key='prod']", ("environment", "prod")),
        ("[principal='x']", ("entity", "x")),
        ("foo.bar[name='baz']", ("bar", "baz")),
        ("simple_field", ("entity", "simple_field")),
    ],
)
def test_extract_drift_label_noun(key: str, expected: tuple[str, str]) -> None:
    assert _extract_drift_label_noun(key) == expected


# --- detect_drift_reentries ---


def test_detect_drift_reentries_empty_returns_empty_list() -> None:
    assert detect_drift_reentries({}) == []


def test_detect_drift_reentries_single_topology_drift_entry() -> None:
    changes = {
        "tasks[task_key='transform']": make_change(
            action="update",
            old={"task_key": "transform"},
            new={"task_key": "transform"},
        ),
    }
    assert detect_drift_reentries(changes) == [("task", "transform")]


def test_detect_drift_reentries_skips_field_drift_and_skip_actions() -> None:
    changes = {
        "tasks[task_key='transform']": make_change(
            action="update",
            old={"task_key": "transform"},
            new={"task_key": "transform"},
        ),
        "edit_mode": make_change(action="update", old="UI", new="UI", remote="EDITABLE"),
        "noise": make_change(action="skip", remote=0),
    }
    assert detect_drift_reentries(changes) == [("task", "transform")]


def test_detect_drift_reentries_sort_stability() -> None:
    """Insertion order must not bleed through — results are sorted by (noun, label)."""
    entry_zulu = make_change(action="update", old={"x": 1}, new={"x": 1})
    entry_alpha = make_change(action="update", old={"y": 2}, new={"y": 2})
    changes = {
        "tasks[task_key='zulu']": entry_zulu,
        "tasks[task_key='alpha']": entry_alpha,
    }
    assert detect_drift_reentries(changes) == [("task", "alpha"), ("task", "zulu")]


def test_detect_drift_reentries_multiple_same_noun() -> None:
    changes = {
        "tasks[task_key='alpha']": make_change(action="update", old={"a": 1}, new={"a": 1}),
        "tasks[task_key='beta']": make_change(action="update", old={"b": 2}, new={"b": 2}),
    }
    pairs = detect_drift_reentries(changes)
    assert pairs == [("task", "alpha"), ("task", "beta")]


# --- iter_non_topology_field_changes ---


def test_iter_non_topology_field_changes_sorts_and_skips_topology() -> None:
    changes = {
        "zeta": make_change(action="update", old=1, new=2),
        "alpha": make_change(action="update", old=3, new=4),
        "tasks[task_key='t']": make_change(action="update", old={"a": 1}, new={"a": 1}),
    }
    result = list(iter_non_topology_field_changes(changes))
    assert [name for name, _, _ in result] == ["alpha", "zeta"]


def test_iter_non_topology_field_changes_retains_field_drift_entries() -> None:
    changes = {
        "edit_mode": make_change(action="update", old="UI", new="UI", remote="EDITABLE"),
    }
    result = list(iter_non_topology_field_changes(changes))
    assert len(result) == 1
    assert result[0][0] == "edit_mode"


# --- _summarize_resource_drift ---


def test_summarize_resource_drift_field_only() -> None:
    entry = make_resource(
        action="update",
        changes={
            "edit_mode": make_change(action="update", old="X", new="X", remote="Y"),
            "field_b": make_change(action="update", old=1, new=1, remote=2),
        },
    )
    summary = _summarize_resource_drift("resources.jobs.pipeline", entry)
    assert summary == DriftSummary(
        resource_type="jobs",
        resource_name="pipeline",
        overwritten_field_count=2,
        reentries=(),
    )


def test_summarize_resource_drift_topology_only() -> None:
    entry = make_resource(
        action="update",
        changes={
            "tasks[task_key='t']": make_change(action="update", old={"a": 1}, new={"a": 1}),
        },
    )
    summary = _summarize_resource_drift("resources.jobs.pipeline", entry)
    assert summary is not None
    assert summary.overwritten_field_count == 0
    assert summary.reentries == (("task", "t"),)


def test_summarize_resource_drift_returns_none_for_no_drift() -> None:
    entry = make_resource(
        action="update",
        changes={"max_concurrent_runs": make_change(action="update", old=1, new=5)},
    )
    assert _summarize_resource_drift("resources.jobs.pipeline", entry) is None


def test_summarize_resource_drift_returns_none_for_skip_only_changes() -> None:
    entry = make_resource(
        action="update",
        changes={
            "foo": make_change(action="skip", reason="empty", remote={}),
            "bar": make_change(action="skip", reason="backend_default", remote="X"),
        },
    )
    assert _summarize_resource_drift("resources.jobs.pipeline", entry) is None


# --- collect_drift_summaries ---


def test_collect_drift_summaries_field_only_resource() -> None:
    resources = {
        "resources.jobs.pipeline": make_resource(
            action="update",
            changes={
                "edit_mode": make_change(action="update", old="UI", new="UI", remote="EDITABLE"),
                "field_b": make_change(action="update", old=1, new=1, remote=2),
            },
        ),
    }
    summaries = collect_drift_summaries(resources)
    assert len(summaries) == 1
    assert summaries[0].resource_type == "jobs"
    assert summaries[0].resource_name == "pipeline"
    assert summaries[0].overwritten_field_count == 2
    assert summaries[0].reentries == ()


def test_collect_drift_summaries_returns_empty_for_no_drift() -> None:
    resources = {
        "resources.jobs.pipeline": make_resource(
            action="update",
            changes={"max_concurrent_runs": make_change(action="update", old=1, new=5)},
        ),
    }
    assert collect_drift_summaries(resources) == []


def test_collect_drift_summaries_topology_only() -> None:
    resources = {
        "resources.jobs.pipeline": make_resource(
            action="update",
            changes={
                "tasks[task_key='t']": make_change(action="update", old={"a": 1}, new={"a": 1}),
            },
        ),
    }
    summaries = collect_drift_summaries(resources)
    assert len(summaries) == 1
    assert summaries[0].overwritten_field_count == 0
    assert len(summaries[0].reentries) == 1


def test_collect_drift_summaries_mixed_field_and_topology() -> None:
    resources = {
        "resources.jobs.pipeline": make_resource(
            action="update",
            changes={
                "edit_mode": make_change(action="update", old="UI", new="UI", remote="EDITABLE"),
                "tasks[task_key='t']": make_change(action="update", old={"a": 1}, new={"a": 1}),
            },
        ),
    }
    summaries = collect_drift_summaries(resources)
    assert len(summaries) == 1
    assert summaries[0].overwritten_field_count == 1
    assert summaries[0].reentries == (("task", "t"),)


def test_collect_drift_summaries_respects_visible_states() -> None:
    resources = {
        "resources.jobs.pipeline": make_resource(
            action="update",
            changes={
                "edit_mode": make_change(action="update", old="UI", new="UI", remote="EDITABLE"),
            },
        ),
    }
    assert collect_drift_summaries(resources, visible_states=frozenset({DiffState.ADDED})) == []


def test_collect_drift_summaries_respects_resource_filter() -> None:
    resources = {
        "resources.jobs.pipeline": make_resource(
            action="update",
            changes={
                "edit_mode": make_change(action="update", old="UI", new="UI", remote="EDITABLE"),
            },
        ),
    }
    assert collect_drift_summaries(resources, resource_filter=lambda k, _: "other" in k) == []


# --- format_display_value (scalar/dict shapes) ---


def test_format_display_value_short_string_shows_quoted() -> None:
    assert format_display_value("hello") == '"hello"'


def test_format_display_value_long_string_shows_ellipsis() -> None:
    assert format_display_value("a" * 50) == "..."


def test_format_display_value_number_shows_inline() -> None:
    assert format_display_value(42) == "42"


def test_format_display_value_dict_shows_inline() -> None:
    assert format_display_value({"a": 1}) == "{a: 1}"
