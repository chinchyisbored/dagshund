"""Direct unit tests for format.py functions."""

import pytest
from factories import make_change

from dagshund.format import (
    _singularize,
    field_action_config,
    format_display_value,
    format_drift_subline_body,
    format_field_suffix,
    format_transition,
)

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
