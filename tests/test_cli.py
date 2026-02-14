"""Tests for dagshund CLI."""

import subprocess
import sys
from pathlib import Path

import pytest

from dagshund import DagshundError
from dagshund.cli import read_plan
from dagshund.text import render_text

FIXTURES_DIR = Path(__file__).parent.parent / "js" / "tests" / "fixtures"


def run_dagshund(*args: str, stdin: str | None = None) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, "-m", "dagshund", *args],
        input=stdin,
        capture_output=True,
        text=True,
    )


def test_version():
    result = run_dagshund("--version")
    assert result.returncode == 0
    assert "dagshund 0.1.0" in result.stdout


def test_default_mode_with_file():
    fixture = FIXTURES_DIR / "sample-plan.json"
    result = run_dagshund(str(fixture))
    assert result.returncode == 0
    assert "etl_pipeline" in result.stdout
    assert "create" in result.stdout


def test_default_mode_with_stdin():
    fixture = FIXTURES_DIR / "sample-plan.json"
    result = run_dagshund(stdin=fixture.read_text())
    assert result.returncode == 0
    assert "etl_pipeline" in result.stdout


def test_complex_plan():
    fixture = FIXTURES_DIR / "complex-plan.json"
    result = run_dagshund(str(fixture))
    assert result.returncode == 0
    assert "create" in result.stdout
    assert "update" in result.stdout
    assert "delete" in result.stdout


def test_summary_counts():
    fixture = FIXTURES_DIR / "complex-plan.json"
    result = run_dagshund(str(fixture))
    assert result.returncode == 0
    # Should have a summary line with counts
    assert "+4 create" in result.stdout or "+4" in result.stdout


def test_invalid_json():
    result = run_dagshund(stdin="not json at all")
    assert result.returncode != 0
    assert "invalid JSON" in result.stderr


def test_no_input_on_tty():
    # When stdin is a TTY and no file is given, should exit with usage message
    # We can't easily simulate a TTY, but we can test the file-not-found case
    result = run_dagshund("/nonexistent/plan.json")
    assert result.returncode != 0


def test_read_plan_raises_on_missing_file():
    """read_plan raises DagshundError for nonexistent files (no subprocess needed)."""
    with pytest.raises(DagshundError, match="file not found"):
        read_plan("/nonexistent/plan.json")


def test_render_text_raises_on_invalid_json():
    """render_text raises DagshundError for bad JSON (no subprocess needed)."""
    with pytest.raises(DagshundError, match="invalid JSON"):
        render_text("not json at all")


def test_render_text_raises_on_non_object():
    """render_text raises DagshundError when JSON is not an object."""
    with pytest.raises(DagshundError, match="must be an object"):
        render_text("[1, 2, 3]")


def test_browser_mode_file_output():
    """Test browser mode writes valid HTML when -o is specified."""
    template = Path(__file__).parent.parent / "src" / "dagshund" / "_assets" / "template.html"
    if not template.exists():
        return  # Skip if template not built

    fixture = FIXTURES_DIR / "sample-plan.json"
    import tempfile

    with tempfile.NamedTemporaryFile(suffix=".html", delete=False) as f:
        output_path = f.name

    try:
        result = run_dagshund(str(fixture), "-o", output_path)
        assert result.returncode == 0
        content = Path(output_path).read_text()
        assert "<!doctype html>" in content
        assert "dagshund" in content
        assert "etl_pipeline" in content
    finally:
        Path(output_path).unlink(missing_ok=True)
