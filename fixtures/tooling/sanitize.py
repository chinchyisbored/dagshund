#!/usr/bin/env python3
"""Deterministic PII sanitizer for databricks bundle plan JSON.

Reads JSON from stdin, writes sanitized JSON to stdout.
Replaces email addresses with deterministic fake values and redacts Unity
Catalog secret payloads. Same input always produces same output.

Usage:
    python3 fixtures/tooling/sanitize.py < raw-plan.json > sanitized-plan.json
    cat raw-plan.json | python3 fixtures/tooling/sanitize.py > sanitized-plan.json
"""

import json
import re
import sys
from typing import Any

# Require at least 2 alpha chars in TLD to avoid false positives like node@v18.0.0
EMAIL_RE = re.compile(r"[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z]{2,}(?:\.[a-zA-Z]{2,})*")

type EmailMapping = dict[str, str]

REDACTED_SECRET_VALUE = "[redacted]"
SECRET_FIELDS = frozenset({"value", "effective_value"})
CHANGE_PAYLOAD_FIELDS = frozenset({"old", "new", "remote"})


def _is_uc_secret_key(key: str) -> bool:
    return key.startswith("resources.secrets.")


def _redact_secret_state(raw: Any) -> Any:  # noqa: ANN401 - JSON boundary
    if not isinstance(raw, dict):
        return raw
    wrapped = raw.get("value")
    if isinstance(wrapped, dict):
        redacted_state = {key: REDACTED_SECRET_VALUE if key in SECRET_FIELDS else value for key, value in raw.items()}
        return {
            **redacted_state,
            "value": {key: REDACTED_SECRET_VALUE if key in SECRET_FIELDS else value for key, value in wrapped.items()},
        }
    return {key: REDACTED_SECRET_VALUE if key in SECRET_FIELDS else value for key, value in raw.items()}


def _redact_change_payload(value: Any) -> Any:  # noqa: ANN401 - JSON boundary
    if value == "" or (isinstance(value, str) and value.lower() == REDACTED_SECRET_VALUE):
        return value
    return REDACTED_SECRET_VALUE


def _redact_secret_change(raw: Any) -> Any:  # noqa: ANN401 - JSON boundary
    if not isinstance(raw, dict):
        return _redact_change_payload(raw)
    return {key: _redact_change_payload(value) if key in CHANGE_PAYLOAD_FIELDS else value for key, value in raw.items()}


def _redact_secret_changes(raw: Any) -> Any:  # noqa: ANN401 - JSON boundary
    if not isinstance(raw, dict):
        return raw
    return {field: _redact_secret_change(change) if field in SECRET_FIELDS else change for field, change in raw.items()}


def _redact_secret_entry(raw: Any) -> Any:  # noqa: ANN401 - JSON boundary
    if not isinstance(raw, dict):
        return raw
    return {
        key: _redact_secret_state(value)
        if key in {"new_state", "remote_state"}
        else _redact_secret_changes(value)
        if key == "changes"
        else value
        for key, value in raw.items()
    }


def _redact_uc_secret_values(raw: Any) -> Any:  # noqa: ANN401 - JSON boundary
    if not isinstance(raw, dict) or not isinstance(raw.get("plan"), dict):
        return raw
    plan = raw["plan"]
    return {
        **raw,
        "plan": {key: _redact_secret_entry(entry) if _is_uc_secret_key(key) else entry for key, entry in plan.items()},
    }


def _fake_email(real: str, emails: EmailMapping) -> tuple[str, EmailMapping]:
    if real in emails:
        return emails[real], emails
    fake = f"user{len(emails) + 1}@example.com"
    return fake, {**emails, real: fake}


def _replace_emails_in_string(text: str, emails: EmailMapping) -> tuple[str, EmailMapping]:
    """Replace all email addresses in a string, preserving surrounding text."""
    parts: list[str] = []
    last_end = 0
    current_emails = emails
    for match in EMAIL_RE.finditer(text):
        parts.append(text[last_end : match.start()])
        fake, current_emails = _fake_email(match.group(0), current_emails)
        parts.append(fake)
        last_end = match.end()
    parts.append(text[last_end:])
    return "".join(parts), current_emails


def _walk(value: Any, emails: EmailMapping) -> tuple[Any, EmailMapping]:  # noqa: ANN401 - JSON boundary
    """Recursively walk a JSON value, replacing email addresses in strings."""
    current_emails = emails
    match value:
        case dict() as d:
            result = {}
            for k, v in d.items():
                walked, current_emails = _walk(v, current_emails)
                result[k] = walked
            return result, current_emails
        case list() as items:
            result_list = []
            for item in items:
                walked, current_emails = _walk(item, current_emails)
                result_list.append(walked)
            return result_list, current_emails
        case str() as text:
            return _replace_emails_in_string(text, current_emails)
        case _:
            return value, current_emails


def sanitize_plan(raw: str) -> str:
    """Parse, sanitize, and serialize a plan JSON string."""
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise SystemExit(f"Invalid JSON input: {exc}") from exc
    sanitized, _ = _walk(_redact_uc_secret_values(data), {})
    return json.dumps(sanitized, indent=2, ensure_ascii=False) + "\n"


def main() -> None:
    if sys.stdin.isatty():
        print("Usage: python3 fixtures/tooling/sanitize.py < raw-plan.json", file=sys.stderr)
        sys.exit(1)

    raw = sys.stdin.read()
    sys.stdout.write(sanitize_plan(raw))


if __name__ == "__main__":
    main()
