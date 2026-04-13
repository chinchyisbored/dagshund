"""Direct unit tests for format.py functions."""

import pytest

from dagshund.format import (
    _singularize,
    field_action_config,
    format_drift_subline_body,
    format_field_suffix,
    format_single_value,
)

# --- field_action_config ---


def test_field_action_config_new_only_returns_create() -> None:
    result = field_action_config({"action": "update", "new": "val"})

    assert result.display == "create"
    assert result.symbol == "+"


def test_field_action_config_old_only_returns_delete() -> None:
    result = field_action_config({"action": "update", "old": "val"})

    assert result.display == "delete"
    assert result.symbol == "-"


def test_field_action_config_both_old_and_new_returns_base() -> None:
    result = field_action_config({"action": "update", "old": "a", "new": "b"})

    assert result.display == "update"
    assert result.show_field_changes is True


def test_field_action_config_remote_only_returns_remote() -> None:
    result = field_action_config({"action": "update", "remote": "val"})

    assert result.display == "remote"
    assert result.symbol == "="


def test_field_action_config_non_field_action_passes_through() -> None:
    result = field_action_config({"action": "create", "new": "val"})

    assert result.display == "create"
    assert result.symbol == "+"


def test_field_action_config_unknown_action_returns_default() -> None:
    result = field_action_config({"action": "bogus"})

    assert result.display == "unknown"
    assert result.symbol == "?"


# --- format_field_suffix ---


def test_format_field_suffix_drift_shows_remote_to_new() -> None:
    change = {"old": "val", "new": "val", "remote": "drifted"}

    result = format_field_suffix(change)

    assert result == ': "drifted" -> "val" (drift)'


def test_format_field_suffix_noop_returns_none() -> None:
    change = {"old": "same", "new": "same"}

    result = format_field_suffix(change)

    assert result is None


def test_format_field_suffix_remote_only() -> None:
    change = {"remote": "server_val"}

    result = format_field_suffix(change)

    assert result == ': "server_val" (remote)'


def test_format_field_suffix_transition() -> None:
    change = {"old": "before", "new": "after"}

    result = format_field_suffix(change)

    assert result == ': "before" -> "after"'


def test_format_field_suffix_new_only() -> None:
    change = {"new": "added_val"}

    result = format_field_suffix(change)

    assert result == ': "added_val"'


def test_format_field_suffix_old_only() -> None:
    change = {"old": "removed_val"}

    result = format_field_suffix(change)

    assert result == ': "removed_val"'


def test_format_field_suffix_no_values_returns_empty() -> None:
    result = format_field_suffix({})

    assert result == ""


# --- format_single_value ---


def test_format_single_value_short_string() -> None:
    assert format_single_value("hello") == ': "hello"'


def test_format_single_value_long_string_truncated() -> None:
    assert format_single_value("x" * 50) == ": ..."


def test_format_single_value_small_dict_inline() -> None:
    result = format_single_value({"key": "val"})

    assert result == ': {key: "val"}'


def test_format_single_value_large_dict_summarized() -> None:
    big_dict = {f"key_{i}": f"value_{i}" for i in range(20)}

    result = format_single_value(big_dict)

    assert result == ": {20 fields}"


def test_format_single_value_small_list_inline() -> None:
    result = format_single_value([1, 2, 3])

    assert result == ": [1, 2, 3]"


def test_format_single_value_large_list_summarized() -> None:
    big_list = list(range(30))

    result = format_single_value(big_list)

    assert result == ": [30 items]"


def test_format_single_value_number() -> None:
    assert format_single_value(42) == ": 42"


def test_format_single_value_boolean() -> None:
    assert format_single_value(True) == ": true"


def test_format_single_value_null() -> None:
    assert format_single_value(None) == ": null"


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
