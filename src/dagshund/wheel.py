"""Wheel-version churn detection (dagshund-aqcx).

CI pipelines rebuild bundle wheel artifacts on every run. On classic compute
every task attaches the wheel via ``libraries[N].whl``, so each task reports an
update — drowning real changes in large DAGs. On serverless the wheel lives in
job-level ``environments[K].spec.dependencies[N]`` and the same bump repeats
once per environment per dependency. This module classifies both shapes so
renderers can suppress the noise and summarize the wheel bump once per job.

Mirrors the TypeScript helper at ``js/src/utils/wheel-updates.ts``; the shared
fixture at ``fixtures/wheel-update-cases.json`` protects the two from drifting
apart.
"""

import re
from collections import defaultdict
from collections.abc import Mapping
from dataclasses import dataclass

from dagshund.model import FieldChange

# Task-scoped wheel library path on classic compute, directly on a task or its nested for-each task.
_TASK_WHEEL_CHANGE_KEY_RE = re.compile(
    r"^tasks\[task_key='([^']+)'\]\.(?:for_each_task\.task\.)?libraries\[\d+\]\.whl$"
)

# Serverless environment dependency: environments[environment_key='K'].spec.dependencies[N].
# Dependencies mix pip specs and wheel paths; the value filter below keeps only wheels.
_ENVIRONMENT_WHEEL_CHANGE_KEY_RE = re.compile(r"^environments\[environment_key='([^']+)'\]\.spec\.dependencies\[\d+\]$")


@dataclass(frozen=True, slots=True)
class WheelUpdate:
    """A wheel artifact replaced by another build of the same distribution."""

    distribution: str
    old_version: str
    new_version: str


@dataclass(frozen=True, slots=True)
class WheelUpdateUsage:
    """A distinct wheel update with the number of carriers it appeared on."""

    update: WheelUpdate
    task_count: int
    environment_count: int


def parse_wheel_filename(path: str) -> tuple[str, str] | None:
    """Extract ``(distribution, version)`` from a wheel path's basename.

    PEP 427 filenames are ``{dist}-{version}(-{build})?-{python}-{abi}-{platform}.whl``
    with hyphens in the distribution name escaped to underscores, so the first
    two dash-separated segments are unambiguous. Returns ``None`` for anything
    that does not look like a wheel filename.
    """
    basename = path.rsplit("/", 1)[-1]
    if not basename.endswith(".whl"):
        return None
    parts = basename[: -len(".whl")].split("-")
    if len(parts) < 5:
        return None
    return parts[0], parts[1]


def classify_wheel_update(change_key: str, change: FieldChange) -> WheelUpdate | None:
    """Classify a field change as a suppressible wheel update, or ``None``.

    A wheel update replaces one wheel path with another whose filename parses
    to the *same* distribution name, on either a task library (classic compute)
    or an environment dependency (serverless). Swapping to a different
    distribution, or adding/removing a wheel, is a real change and stays visible.
    """
    if (
        _TASK_WHEEL_CHANGE_KEY_RE.match(change_key) is None
        and _ENVIRONMENT_WHEEL_CHANGE_KEY_RE.match(change_key) is None
    ):
        return None
    if not (isinstance(change.old, str) and isinstance(change.new, str)):
        return None
    if change.old == change.new:
        return None
    old_parsed = parse_wheel_filename(change.old)
    new_parsed = parse_wheel_filename(change.new)
    if old_parsed is None or new_parsed is None or old_parsed[0] != new_parsed[0]:
        return None
    return WheelUpdate(
        distribution=old_parsed[0],
        old_version=old_parsed[1],
        new_version=new_parsed[1],
    )


def collect_wheel_updates(changes: Mapping[str, FieldChange]) -> dict[str, WheelUpdate]:
    """Map each wheel-update change key in ``changes`` to its classification."""
    return {
        change_key: update
        for change_key, change in changes.items()
        if (update := classify_wheel_update(change_key, change)) is not None
    }


def summarize_wheel_updates(wheel_updates: Mapping[str, WheelUpdate]) -> list[WheelUpdateUsage]:
    """Deduplicate wheel updates and count distinct carriers per distinct update.

    Sorted by distribution name so multi-wheel jobs render deterministically.
    """
    tasks_by_update: defaultdict[WheelUpdate, set[str]] = defaultdict(set)
    environments_by_update: defaultdict[WheelUpdate, set[str]] = defaultdict(set)
    for change_key, update in wheel_updates.items():
        task_match = _TASK_WHEEL_CHANGE_KEY_RE.match(change_key)
        if task_match is not None:
            tasks_by_update[update].add(task_match.group(1))
            continue
        environment_match = _ENVIRONMENT_WHEEL_CHANGE_KEY_RE.match(change_key)
        if environment_match is not None:
            environments_by_update[update].add(environment_match.group(1))
    return sorted(
        (
            WheelUpdateUsage(
                update=update,
                task_count=len(tasks_by_update.get(update, ())),
                environment_count=len(environments_by_update.get(update, ())),
            )
            for update in tasks_by_update.keys() | environments_by_update.keys()
        ),
        key=lambda usage: (usage.update.distribution, usage.update.old_version, usage.update.new_version),
    )
