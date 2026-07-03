"""Tests for wheel.py — wheel-version churn detection (dagshund-aqcx).

The classify tests iterate the shared fixture at
``fixtures/wheel-update-cases.json`` that is also consumed by the TypeScript
test at ``js/tests/utils/wheel-updates.test.ts``. Any algorithm drift between
the two language implementations fails on both sides simultaneously.
"""

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, cast

import pytest
from factories import make_change

from dagshund.model import UNSET, FieldChange
from dagshund.wheel import (
    WheelUpdate,
    WheelUpdateUsage,
    classify_wheel_update,
    collect_wheel_updates,
    parse_wheel_filename,
    summarize_wheel_updates,
)

_FIXTURE_PATH = Path(__file__).resolve().parent.parent / "fixtures" / "wheel-update-cases.json"


@dataclass(frozen=True, slots=True)
class _WheelCase:
    name: str
    change_key: str
    old: object
    new: object
    expected: WheelUpdate | None


def _parse_expected(raw: dict[str, Any] | None) -> WheelUpdate | None:
    if raw is None:
        return None
    return WheelUpdate(
        distribution=raw["distribution"],
        old_version=raw["oldVersion"],
        new_version=raw["newVersion"],
    )


def _load_cases() -> list[_WheelCase]:
    data = cast("dict[str, Any]", json.loads(_FIXTURE_PATH.read_text()))
    return [
        _WheelCase(
            name=c["name"],
            change_key=c["changeKey"],
            old=c.get("old", UNSET),
            new=c.get("new", UNSET),
            expected=_parse_expected(c["expected"]),
        )
        for c in data["cases"]
    ]


_CASES = _load_cases()


@pytest.mark.parametrize("case", _CASES, ids=[c.name for c in _CASES])
def test_classify_wheel_update_shared_fixture(case: _WheelCase) -> None:
    change = make_change("update", old=case.old, new=case.new)

    assert classify_wheel_update(case.change_key, change) == case.expected


# --- parse_wheel_filename ---


def test_parse_wheel_filename_standard_tags() -> None:
    assert parse_wheel_filename("/a/b/etl_lib-0.1.0-py3-none-any.whl") == ("etl_lib", "0.1.0")


def test_parse_wheel_filename_build_tag() -> None:
    assert parse_wheel_filename("model_lib-2.0.0-1-py3-none-any.whl") == ("model_lib", "2.0.0")


def test_parse_wheel_filename_too_few_segments_returns_none() -> None:
    assert parse_wheel_filename("/wheels/bundle.whl") is None


def test_parse_wheel_filename_non_whl_extension_returns_none() -> None:
    assert parse_wheel_filename("/jars/etl_lib-0.1.0-py3-none-any.jar") is None


# --- collect_wheel_updates / summarize_wheel_updates ---


def _wheel_change(old_version: str, new_version: str, distribution: str = "etl_lib") -> FieldChange:
    return make_change(
        "update",
        old=f"/Workspace/artifacts/.internal/{distribution}-{old_version}-py3-none-any.whl",
        new=f"/Workspace/artifacts/.internal/{distribution}-{new_version}-py3-none-any.whl",
    )


def test_collect_wheel_updates_keeps_only_wheel_keys() -> None:
    changes = {
        "tasks[task_key='ingest'].libraries[0].whl": _wheel_change("0.1.0", "0.2.0"),
        "tasks[task_key='ingest'].notebook_task.notebook_path": make_change("update", old="/a", new="/b"),
    }

    collected = collect_wheel_updates(changes)

    assert set(collected) == {"tasks[task_key='ingest'].libraries[0].whl"}
    assert collected["tasks[task_key='ingest'].libraries[0].whl"] == WheelUpdate("etl_lib", "0.1.0", "0.2.0")


def test_summarize_wheel_updates_counts_distinct_tasks_per_wheel() -> None:
    changes = {
        "tasks[task_key='ingest'].libraries[0].whl": _wheel_change("0.1.0", "0.2.0"),
        "tasks[task_key='transform'].libraries[0].whl": _wheel_change("0.1.0", "0.2.0"),
        "tasks[task_key='enrich'].libraries[1].whl": _wheel_change("1.4.0", "1.5.0", distribution="scoring_lib"),
    }

    summary = summarize_wheel_updates(collect_wheel_updates(changes))

    assert summary == [
        WheelUpdateUsage(WheelUpdate("etl_lib", "0.1.0", "0.2.0"), task_count=2, environment_count=0),
        WheelUpdateUsage(WheelUpdate("scoring_lib", "1.4.0", "1.5.0"), task_count=1, environment_count=0),
    ]


def test_summarize_wheel_updates_same_task_two_libraries_counted_once() -> None:
    changes = {
        "tasks[task_key='enrich'].libraries[0].whl": _wheel_change("0.1.0", "0.2.0"),
        "tasks[task_key='enrich'].libraries[2].whl": _wheel_change("0.1.0", "0.2.0"),
    }

    summary = summarize_wheel_updates(collect_wheel_updates(changes))

    assert summary == [WheelUpdateUsage(WheelUpdate("etl_lib", "0.1.0", "0.2.0"), task_count=1, environment_count=0)]


def test_summarize_wheel_updates_counts_environments_per_wheel() -> None:
    changes = {
        "environments[environment_key='etl'].spec.dependencies[0]": _wheel_change("0.1.0", "0.2.0"),
        "environments[environment_key='scoring'].spec.dependencies[0]": _wheel_change("0.1.0", "0.2.0"),
        "environments[environment_key='scoring'].spec.dependencies[1]": _wheel_change(
            "1.0.0", "1.1.0", distribution="scoring_lib"
        ),
    }

    summary = summarize_wheel_updates(collect_wheel_updates(changes))

    assert summary == [
        WheelUpdateUsage(WheelUpdate("etl_lib", "0.1.0", "0.2.0"), task_count=0, environment_count=2),
        WheelUpdateUsage(WheelUpdate("scoring_lib", "1.0.0", "1.1.0"), task_count=0, environment_count=1),
    ]


def test_summarize_wheel_updates_empty_input() -> None:
    assert summarize_wheel_updates({}) == []
