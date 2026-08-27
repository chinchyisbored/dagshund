import json
import re
import sys
from importlib.resources import files
from pathlib import Path

from dagshund.model import Plan
from dagshund.provenance import HtmlProvenance
from dagshund.types import DagshundError

PLACEHOLDER = "__DAGSHUND_PLAN_JSON__"
PROVENANCE_PLACEHOLDER = "__DAGSHUND_PROVENANCE_JSON__"


def _load_template() -> str:
    resource = files("dagshund._assets").joinpath("template.html")
    if not resource.is_file():
        raise DagshundError("template.html not found — run 'just build' in the repo root first")
    return resource.read_text(encoding="utf-8")


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


def _serialize_provenance(provenance: HtmlProvenance) -> str:
    return json.dumps(
        {
            "source_name": provenance.source_name,
            "source_modified_at": provenance.source_modified_at,
            "source_plan_sha256": provenance.source_plan_sha256,
            "dagshund_version": provenance.dagshund_version,
            "plan_cli_version": provenance.plan_cli_version,
        },
        separators=(",", ":"),
    )


def _validate_placeholder(template: str, placeholder: str) -> None:
    count = template.count(placeholder)
    if count == 0:
        raise DagshundError(
            f"placeholder {placeholder} not found in template - template may be outdated, rebuild with 'just build'"
        )
    if count > 1:
        raise DagshundError(f"expected 1 placeholder in template, found {count}")


def _inject_plan(template: str, plan: Plan, provenance: HtmlProvenance | None = None) -> str:
    replacements = {PLACEHOLDER: _escape_for_script_tag(json.dumps(plan.raw, separators=(",", ":")))}
    if provenance is not None or PROVENANCE_PLACEHOLDER in template:
        provenance_json = "null" if provenance is None else _serialize_provenance(provenance)
        replacements[PROVENANCE_PLACEHOLDER] = _escape_for_script_tag(provenance_json)

    for placeholder in replacements:
        _validate_placeholder(template, placeholder)

    pattern = re.compile("|".join(re.escape(placeholder) for placeholder in replacements))
    return pattern.sub(lambda match: replacements[match.group(0)], template)


def _validate_output_path(raw: str) -> Path:
    """Resolve and validate the output path before writing.

    Rejects a symlinked output file (which could silently overwrite an
    unrelated target) and normalizes ``..`` traversal segments. Symlinked
    parent directories remain supported.
    """
    path = Path(raw)
    if path.is_symlink():
        target = path.resolve()
        raise DagshundError(f"output path is a symlink → {target}\n  use --output {target} to write there directly")
    return path.resolve()


def render_browser(plan: Plan, *, output_path: str, provenance: HtmlProvenance | None = None) -> None:
    resolved = _validate_output_path(output_path)
    template = _load_template()
    html = _inject_plan(template, plan, provenance)

    try:
        resolved.write_text(html, encoding="utf-8")
    except OSError as exc:
        raise DagshundError(f"could not write output file: {exc}") from exc

    print(f"dagshund: exported to {output_path}", file=sys.stderr)
