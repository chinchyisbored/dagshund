"""Tests for the debug tracing module."""

from dagshund.debug import _summarize_value

# --- _summarize_value ---


def test_summarize_value_short_string() -> None:
    assert _summarize_value("hello") == "str(5) 'hello'"


def test_summarize_value_long_string_shows_char_count() -> None:
    result = _summarize_value("a" * 100)
    assert result == f"str(100) '{'a' * 20}'..."


def test_summarize_value_string_at_boundary() -> None:
    assert _summarize_value("a" * 20) == f"str(20) '{'a' * 20}'"
    assert _summarize_value("a" * 21) == f"str(21) '{'a' * 20}'..."


def test_summarize_value_dict_shows_key_count() -> None:
    assert _summarize_value({"a": 1, "b": 2}) == "dict(2 keys)"


def test_summarize_value_empty_dict() -> None:
    assert _summarize_value({}) == "dict(0 keys)"


def test_summarize_value_bool() -> None:
    assert _summarize_value(True) == "True"
    assert _summarize_value(False) == "False"


def test_summarize_value_none() -> None:
    assert _summarize_value(None) == "None"


def test_summarize_value_int_uses_repr() -> None:
    assert _summarize_value(42) == "42"


def test_summarize_value_list_shows_item_count() -> None:
    assert _summarize_value([1, 2]) == "list(2 items)"


def test_summarize_value_tuple_shows_item_count() -> None:
    assert _summarize_value((1, 2, 3)) == "tuple(3 items)"
