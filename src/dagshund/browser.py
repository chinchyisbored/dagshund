"""Browser-based HTML visualization."""

import json
from pathlib import Path

from dagshund import DagshundError

PLACEHOLDER = "__DAGSHUND_PLAN_JSON__"


def _find_template() -> Path:
    """Locate the template.html asset bundled with the package."""
    template_path = Path(__file__).parent / "_assets" / "template.html"
    if not template_path.exists():
        raise DagshundError("template.html not found. Run 'just template' in the repo root first.")
    return template_path


def _parse_plan(raw: str) -> dict:
    """Parse and validate plan JSON.

    Keep in sync with _parse_plan() in text.py — both share the same contract.
    """
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise DagshundError(f"invalid JSON: {exc}") from exc

    if not isinstance(data, dict):
        raise DagshundError("plan JSON must be an object")

    return data


def _escape_for_script_tag(content: str) -> str:
    """Escape content that will be placed inside a <script> tag.

    Keep in sync with escapeForScriptTag() in js/src/html-assembler.ts.
    """
    return content.replace("</script", r"<\/script").replace("<!--", r"<\!--")


def _inject_plan(template: str, plan_data: dict) -> str:
    """Replace the placeholder in template HTML with actual plan JSON."""
    safe_json = _escape_for_script_tag(json.dumps(plan_data, separators=(",", ":")))
    return template.replace(PLACEHOLDER, safe_json)


def render_browser(plan_json: str, *, output_path: str) -> None:
    """Render plan as interactive HTML and export to file."""
    plan_data = _parse_plan(plan_json)
    template_path = _find_template()
    template = template_path.read_text(encoding="utf-8")
    html = _inject_plan(template, plan_data)

    try:
        Path(output_path).write_text(html, encoding="utf-8")
    except OSError as exc:
        raise DagshundError(f"could not write output file: {exc}") from exc

    print(f"dagshund: exported to {output_path}")
