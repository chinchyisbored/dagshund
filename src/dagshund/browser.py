"""Browser-based HTML visualization."""

import json
import sys
from pathlib import Path

PLACEHOLDER = "__DAGSHUND_PLAN_JSON__"


def _find_template() -> Path:
    """Locate the template.html asset bundled with the package."""
    template_path = Path(__file__).parent / "_assets" / "template.html"
    if not template_path.exists():
        print(
            "dagshund: template.html not found. Run 'just template' in the repo root first.",
            file=sys.stderr,
        )
        sys.exit(1)
    return template_path


def _validate_plan_json(raw: str) -> dict:
    """Parse JSON and do basic structural validation."""
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        print(f"dagshund: invalid JSON: {exc}", file=sys.stderr)
        sys.exit(1)

    if not isinstance(data, dict):
        print("dagshund: plan JSON must be an object", file=sys.stderr)
        sys.exit(1)

    return data


def _escape_for_script_tag(content: str) -> str:
    """Escape content that will be placed inside a <script> tag."""
    return content.replace("</script", r"<\/script").replace("<!--", r"<\!--")


def _inject_plan(template: str, plan_data: dict) -> str:
    """Replace the placeholder in template HTML with actual plan JSON."""
    safe_json = _escape_for_script_tag(json.dumps(plan_data, separators=(",", ":")))
    return template.replace(PLACEHOLDER, safe_json)


def render_browser(plan_json: str, *, output_path: str) -> None:
    """Render plan as interactive HTML and export to file."""
    plan_data = _validate_plan_json(plan_json)
    template_path = _find_template()
    template = template_path.read_text(encoding="utf-8")
    html = _inject_plan(template, plan_data)

    Path(output_path).write_text(html, encoding="utf-8")
    print(f"dagshund: exported to {output_path}")
