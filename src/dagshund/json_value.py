"""Equality semantics for arbitrary JSON values."""

from collections.abc import Mapping


def json_values_equal(left: object, right: object) -> bool:
    """Compare JSON values without conflating booleans and numbers."""
    if left is right:
        return True
    match left, right:
        case bool(), bool():
            return left == right
        case int() | float(), int() | float() if type(left) is not bool and type(right) is not bool:
            return left == right
        case str(), str():
            return left == right
        case None, None:
            return True
        case list(), list():
            return len(left) == len(right) and all(
                json_values_equal(left_item, right_item) for left_item, right_item in zip(left, right, strict=True)
            )
        case Mapping(), Mapping():
            return left.keys() == right.keys() and all(json_values_equal(left[key], right[key]) for key in left)
        case _:
            return False
