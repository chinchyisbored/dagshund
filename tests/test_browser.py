from pathlib import Path

import pytest

from dagshund import DagshundError
from dagshund.browser import (
    PLACEHOLDER,
    _escape_for_script_tag,
    _find_template,
    _inject_plan,
    render_browser,
)

# --- _find_template ---


def test_find_template_returns_existing_path(require_template: None) -> None:
    result = _find_template()

    assert result.name == "template.html"
    assert result.exists()


def test_find_template_raises_when_missing(tmp_path: Path) -> None:
    import dagshund.browser as browser_mod

    original = browser_mod.__file__
    try:
        browser_mod.__file__ = str(tmp_path / "browser.py")
        with pytest.raises(DagshundError, match=r"template\.html not found"):
            _find_template()
    finally:
        browser_mod.__file__ = original


# --- _escape_for_script_tag ---


def test_escape_for_script_tag_replaces_angle_bracket() -> None:
    assert _escape_for_script_tag("<script>") == "\\u003cscript>"


def test_escape_for_script_tag_replaces_all_occurrences() -> None:
    assert _escape_for_script_tag("<a><b>") == "\\u003ca>\\u003cb>"


def test_escape_for_script_tag_no_brackets_unchanged() -> None:
    assert _escape_for_script_tag("hello world") == "hello world"


def test_escape_for_script_tag_closing_script() -> None:
    result = _escape_for_script_tag("</script>")
    assert "<" not in result
    assert "\\u003c" in result


# --- _inject_plan ---


def test_inject_plan_replaces_placeholder() -> None:
    template = f"<html>{PLACEHOLDER}</html>"

    result = _inject_plan(template, {"key": "value"})

    assert PLACEHOLDER not in result
    assert "key" in result
    assert "value" in result


def test_inject_plan_missing_placeholder_raises() -> None:
    with pytest.raises(DagshundError, match="not found"):
        _inject_plan("<html>no placeholder</html>", {"key": "value"})


def test_inject_plan_duplicate_placeholder_raises() -> None:
    template = f"<script>{PLACEHOLDER}</script><!-- {PLACEHOLDER} -->"
    with pytest.raises(DagshundError, match="found 2"):
        _inject_plan(template, {"key": "value"})


def test_inject_plan_escapes_angle_brackets_in_values() -> None:
    """Injected JSON must not contain raw < inside the script block."""
    template = f"<script>{PLACEHOLDER}</script>"

    result = _inject_plan(template, {"html": "<script>alert(1)</script>"})

    injected_part = result.replace("<script>", "").replace("</script>", "")
    assert "<" not in injected_part


def test_inject_plan_uses_compact_json() -> None:
    template = f"<div>{PLACEHOLDER}</div>"

    result = _inject_plan(template, {"a": 1, "b": 2})

    assert '" :' not in result
    assert '", ' not in result


# --- render_browser (integration) ---


def test_render_browser_writes_html_file(require_template: None, tmp_path: Path) -> None:
    output = tmp_path / "output.html"

    render_browser({"plan": {}}, output_path=str(output))

    assert output.exists()
    content = output.read_text()
    assert "<!doctype html>" in content.lower() or "<html" in content.lower()


def test_render_browser_prints_success_message(
    require_template: None, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    output = tmp_path / "output.html"

    render_browser({"plan": {}}, output_path=str(output))

    assert "exported to" in capsys.readouterr().out


def test_render_browser_write_error_raises(require_template: None, tmp_path: Path) -> None:
    bad_path = tmp_path / "nonexistent" / "deep" / "output.html"

    with pytest.raises(DagshundError, match="could not write output file"):
        render_browser({"plan": {}}, output_path=str(bad_path))
