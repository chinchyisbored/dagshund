"""Tests for change_path.extract_list_element_semantic (dagshund-1naj).

Iterates the shared fixture at ``fixtures/list-element-semantic-cases.json``
that is also consumed by the TypeScript test at
``js/tests/utils/field-action.test.ts``. Any algorithm drift between the two
language implementations fails on both sides simultaneously.
"""

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, cast

import pytest

from dagshund.change_path import FieldChangeContext, extract_list_element_semantic

_FIXTURE_PATH = Path(__file__).resolve().parent.parent / "fixtures" / "list-element-semantic-cases.json"


@dataclass(frozen=True, slots=True)
class _SemanticCase:
    name: str
    change_key: str
    new_state: object | None
    remote_state: object | None
    expected: str | None


def _load_cases() -> list[_SemanticCase]:
    data = cast("dict[str, Any]", json.loads(_FIXTURE_PATH.read_text()))
    return [
        _SemanticCase(
            name=c["name"],
            change_key=c["changeKey"],
            new_state=c["newState"],
            remote_state=c["remoteState"],
            expected=c["expected"],
        )
        for c in data["cases"]
    ]


_CASES = _load_cases()


@pytest.mark.parametrize("case", _CASES, ids=[c.name for c in _CASES])
def test_extract_list_element_semantic_shared_fixture(case: _SemanticCase) -> None:
    ctx = FieldChangeContext(
        change_key=case.change_key,
        new_state=case.new_state,
        remote_state=case.remote_state,
    )
    assert extract_list_element_semantic(ctx) == case.expected


def test_extract_list_element_semantic_ignores_resource_has_shape_drift_flag() -> None:
    """The semantic classification is independent of the drift flag (which gates drift, not semantic)."""
    ctx = FieldChangeContext(
        change_key="depends_on[task_key='ingest']",
        new_state={"depends_on": []},
        remote_state={"depends_on": [{"task_key": "ingest"}]},
        resource_has_shape_drift=True,
    )
    assert extract_list_element_semantic(ctx) == "delete"

    ctx_no_drift = FieldChangeContext(
        change_key="depends_on[task_key='ingest']",
        new_state={"depends_on": []},
        remote_state={"depends_on": [{"task_key": "ingest"}]},
        resource_has_shape_drift=False,
    )
    assert extract_list_element_semantic(ctx_no_drift) == "delete"
