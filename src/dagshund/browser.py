"""Browser-based HTML visualization."""

import json
from pathlib import Path

from dagshund import DagshundError, Plan, parse_plan

PLACEHOLDER = "__DAGSHUND_PLAN_JSON__"


def _find_template() -> Path:
    """Locate the template.html asset bundled with the package."""
    template_path = Path(__file__).parent / "_assets" / "template.html"
    if not template_path.exists():
        raise DagshundError("template.html not found. Run 'just template' in the repo root first.")
    return template_path


def _escape_for_script_tag(content: str) -> str:
    r"""Escape JSON content that will be placed inside a <script> tag.

    Replaces every ``<`` with ``\u003c`` so the HTML parser never sees a
    tag-open character inside the script block.  This is the industry-standard
    approach (used by Django, Rails, etc.) and eliminates an entire class of
    injection vectors — not just ``</script`` and ``<!--``.

    Only safe for JSON / data strings — NOT for arbitrary JS code (where
    ``\u003c`` is invalid outside string literals).

    Keep in sync with escapeJsonForScript() in js/src/html-assembler.ts.
    """
    return content.replace("<", "\\u003c")


def _inject_plan(template: str, plan_data: Plan) -> str:
    """Replace the placeholder in template HTML with actual plan JSON."""
    count = template.count(PLACEHOLDER)
    if count == 0:
        raise DagshundError(
            f"placeholder {PLACEHOLDER} not found in template — template may be outdated, rebuild with 'just template'"
        )
    if count > 1:
        raise DagshundError(f"expected 1 placeholder in template, found {count}")
    safe_json = _escape_for_script_tag(json.dumps(plan_data, separators=(",", ":")))
    return template.replace(PLACEHOLDER, safe_json, 1)


def render_browser(plan_json: str, *, output_path: str) -> None:
    """Render plan as interactive HTML and export to file."""
    plan_data = parse_plan(plan_json)
    template_path = _find_template()
    template = template_path.read_text(encoding="utf-8")
    html = _inject_plan(template, plan_data)

    try:
        Path(output_path).write_text(html, encoding="utf-8")
    except OSError as exc:
        raise DagshundError(f"could not write output file: {exc}") from exc

    print(f"dagshund: exported to {output_path}")
