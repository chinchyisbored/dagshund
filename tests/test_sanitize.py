"""Tests for fixtures/sanitize.py — deterministic email sanitization."""

import json
import subprocess
import sys
from pathlib import Path

import pytest

SANITIZE_SCRIPT = Path(__file__).parent.parent / "fixtures" / "tooling" / "sanitize.py"
UNSANITIZED_DIR = Path(__file__).parent.parent / "unsanitized_fixtures"


def _run_sanitizer(input_json: str) -> str:
    result = subprocess.run(
        [sys.executable, str(SANITIZE_SCRIPT)],
        input=input_json,
        capture_output=True,
        text=True,
        check=True,
    )
    return result.stdout


def _sanitize_dict(data: dict) -> dict:
    return json.loads(_run_sanitizer(json.dumps(data)))


# --- Determinism ---


def test_sanitize_same_input_produces_identical_output() -> None:
    plan = {"plan": {"creator": "alice@corp.com", "path": "/Users/alice@corp.com/x"}}

    first = _run_sanitizer(json.dumps(plan))
    second = _run_sanitizer(json.dumps(plan))

    assert first == second


# --- Email replacement ---


def test_sanitize_replaces_email_in_field() -> None:
    plan = {"plan": {"creator_user_name": "alice@corp.com"}}

    result = _sanitize_dict(plan)

    assert result["plan"]["creator_user_name"] == "user1@example.com"


def test_sanitize_email_in_path_replaces_only_email() -> None:
    plan = {"plan": {"path": "/Workspace/Users/alice@corp.com/.bundle/test/metadata.json"}}

    result = _sanitize_dict(plan)

    assert "alice@corp.com" not in result["plan"]["path"]
    assert "user1@example.com" in result["plan"]["path"]
    assert result["plan"]["path"].endswith("/.bundle/test/metadata.json")


def test_sanitize_same_email_maps_consistently() -> None:
    plan = {
        "plan": {
            "creator": "alice@corp.com",
            "runner": "alice@corp.com",
            "path": "/Workspace/Users/alice@corp.com/test",
        }
    }

    result = _sanitize_dict(plan)
    fake = result["plan"]["creator"]

    assert result["plan"]["runner"] == fake
    assert fake in result["plan"]["path"]


def test_sanitize_distinct_emails_get_distinct_fakes() -> None:
    plan = {
        "plan": {
            "creator": "alice@corp.com",
            "runner": "bob@corp.com",
        }
    }

    result = _sanitize_dict(plan)

    assert result["plan"]["creator"] != result["plan"]["runner"]
    assert "example.com" in result["plan"]["creator"]
    assert "example.com" in result["plan"]["runner"]


def test_sanitize_multiple_emails_in_one_string() -> None:
    plan = {"plan": {"msg": "from alice@corp.com to bob@corp.com"}}

    result = _sanitize_dict(plan)

    assert "alice@corp.com" not in result["plan"]["msg"]
    assert "bob@corp.com" not in result["plan"]["msg"]
    assert "example.com" in result["plan"]["msg"]


def test_sanitize_email_regex_ignores_non_email() -> None:
    plan = {"plan": {"version": "node@v18.0.0", "key": "abc@123"}}

    result = _sanitize_dict(plan)

    assert result["plan"]["version"] == "node@v18.0.0"
    assert result["plan"]["key"] == "abc@123"


def test_sanitize_handles_multi_segment_tld() -> None:
    plan = {"plan": {"creator": "alice@corp.co.uk", "runner": "bob@company.com.au"}}

    result = _sanitize_dict(plan)

    assert result["plan"]["creator"] == "user1@example.com"
    assert result["plan"]["runner"] == "user2@example.com"


# --- Passthrough ---


def test_sanitize_preserves_uuids() -> None:
    plan = {"lineage": "c2fdcdd1-d35b-43d6-968e-400dcbce4ea1", "plan": {}}

    result = _sanitize_dict(plan)

    assert result["lineage"] == "c2fdcdd1-d35b-43d6-968e-400dcbce4ea1"


def test_sanitize_preserves_numeric_ids() -> None:
    plan = {"plan": {"remote_state": {"job_id": 230605823298145}}}

    result = _sanitize_dict(plan)

    assert result["plan"]["remote_state"]["job_id"] == 230605823298145


def test_sanitize_preserves_timestamps() -> None:
    plan = {"plan": {"remote_state": {"created_time": 1774050442814}}}

    result = _sanitize_dict(plan)

    assert result["plan"]["remote_state"]["created_time"] == 1774050442814


def test_sanitize_preserves_booleans_and_nulls() -> None:
    plan = {"plan": {"enabled": True, "disabled": False, "empty": None}}

    result = _sanitize_dict(plan)

    assert result["plan"]["enabled"] is True
    assert result["plan"]["disabled"] is False
    assert result["plan"]["empty"] is None


def test_sanitize_preserves_non_sensitive_strings() -> None:
    plan = {"plan": {"action": "update", "task_key": "extract", "kind": "BUNDLE"}}

    result = _sanitize_dict(plan)

    assert result["plan"] == plan["plan"]


def test_sanitize_empty_plan() -> None:
    plan = {"plan": {}}

    result = _sanitize_dict(plan)

    assert result == {"plan": {}}


def test_sanitize_deeply_nested_structure() -> None:
    plan = {"plan": {"a": {"b": {"c": {"d": {"creator": "alice@corp.com"}}}}}}

    result = _sanitize_dict(plan)

    assert result["plan"]["a"]["b"]["c"]["d"]["creator"] == "user1@example.com"


# --- Real fixture round-trip ---


@pytest.mark.skipif(
    not (UNSANITIZED_DIR / "drift-plan.json").exists(),
    reason="unsanitized_fixtures not available",
)
def test_sanitize_no_pii_leaks_in_drift_fixture() -> None:
    unsanitized = (UNSANITIZED_DIR / "drift-plan.json").read_text()

    result = _run_sanitizer(unsanitized)

    assert "squiggly" not in result
    assert "passfwd" not in result
