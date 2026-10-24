import pytest

from dagshund.json_value import json_values_equal


@pytest.mark.parametrize(
    ("left", "right", "expected"),
    [
        (True, 1, False),
        (False, 0, False),
        (1, 1.0, True),
        ([1, {"flag": True}], [1.0, {"flag": 1}], False),
        ({"flag": True, "value": [1, 2]}, {"value": [1, 2], "flag": True}, True),
        ([1, 2], [2, 1], False),
        (None, None, True),
        (None, False, False),
        ("1", 1, False),
    ],
)
def test_json_values_equal_category_and_structure(left: object, right: object, expected: bool) -> None:
    assert json_values_equal(left, right) is expected


def test_json_values_equal_same_non_json_object_by_identity() -> None:
    value = object()

    assert json_values_equal(value, value)


def test_json_values_equal_distinct_non_json_objects() -> None:
    assert json_values_equal(object(), object()) is False
