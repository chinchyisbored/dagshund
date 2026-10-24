from collections.abc import Mapping

import pytest

from dagshund.state import extract_new_state, extract_remote_state


@pytest.mark.parametrize(
    ("state", "allow_bare", "expected"),
    [
        ({"value": {"field": 1}, "vars": {}}, False, {"field": 1}),
        ({"field": 1}, False, None),
        ({"field": 1}, True, {"field": 1}),
        ({"value": {}}, False, {}),
        ({"value": None}, False, None),
        ({"value": 1}, False, None),
        ({"value": []}, False, None),
        ({"value": {"value": "literal"}}, False, {"value": "literal"}),
        ({}, True, {}),
        ([], True, None),
        (None, True, None),
        ({"value": None, "field": 1}, True, {"value": None, "field": 1}),
        ({"value": 1, "field": 1}, True, {"value": 1, "field": 1}),
    ],
    ids=[
        "wrapped",
        "bare-rejected",
        "bare-allowed",
        "empty-wrapped",
        "null",
        "scalar",
        "list",
        "ambiguous-inner-value",
        "empty-bare",
        "non-mapping-list",
        "none",
        "null-value-bare-fallback",
        "scalar-value-bare-fallback",
    ],
)
def test_extract_new_state(state: object, allow_bare: bool, expected: Mapping[str, object] | None) -> None:
    assert extract_new_state(state, allow_bare=allow_bare) == expected


def test_extract_new_state_returns_borrowed_mapping_without_mutation() -> None:
    value = {"field": [1]}
    wrapper = {"value": value, "vars": {"x": 1}}
    snapshot = {"value": {"field": [1]}, "vars": {"x": 1}}

    assert extract_new_state(wrapper) is value
    assert extract_new_state(wrapper, allow_bare=True) is value
    assert wrapper == snapshot


@pytest.mark.parametrize(
    "state",
    [{"value": {"field": 1}}, {"value": None}, {"field": 1}, {}],
    ids=["literal-value-member", "null-value-member", "bare", "empty"],
)
def test_extract_remote_state_returns_mapping_unchanged(state: dict[str, object]) -> None:
    result = extract_remote_state(state)

    assert result is state


@pytest.mark.parametrize("state", [None, [], "state"], ids=["none", "list", "scalar"])
def test_extract_remote_state_rejects_non_mapping(state: object) -> None:
    assert extract_remote_state(state) is None
