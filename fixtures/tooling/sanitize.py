#!/usr/bin/env python3
"""Deterministic PII sanitizer for databricks bundle plan JSON.

Reads JSON from stdin, writes sanitized JSON to stdout.
Replaces email addresses with deterministic fake values.
Same input always produces same output.

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


def _walk(value: Any, emails: EmailMapping) -> tuple[Any, EmailMapping]:  # noqa: ANN401 — JSON boundary
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
    sanitized, _ = _walk(data, {})
    return json.dumps(sanitized, indent=2, ensure_ascii=False) + "\n"


def main() -> None:
    if sys.stdin.isatty():
        print("Usage: python3 fixtures/tooling/sanitize.py < raw-plan.json", file=sys.stderr)
        sys.exit(1)

    raw = sys.stdin.read()
    sys.stdout.write(sanitize_plan(raw))


if __name__ == "__main__":
    main()
