"""Tests for offline public showcase generation."""

import importlib.util
import json
import subprocess
from pathlib import Path

import pytest

SCRIPT = Path(__file__).parent.parent / "fixtures" / "tooling" / "build_showcases.py"
SPEC = importlib.util.spec_from_file_location("build_showcases", SCRIPT)
assert SPEC is not None
assert SPEC.loader is not None
BUILD_SHOWCASES = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BUILD_SHOWCASES)


def _write_inputs(tmp_path: Path, records: object) -> tuple[Path, Path, Path, Path]:
    manifest = tmp_path / "showcases.json"
    manifest.write_text(json.dumps(records))
    template = tmp_path / "index.html"
    template.write_text('<div class="cards">\n      <!-- showcase-cards -->\n</div>')
    fixtures = tmp_path / "golden"
    for name in ("one", "two"):
        (fixtures / name).mkdir(parents=True)
        (fixtures / name / "plan.json").write_text("{}")
    return manifest, template, fixtures, tmp_path / "public"


def test_build_showcases_renders_ordered_escaped_cards_and_reports(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    manifest, template, fixtures, output = _write_inputs(
        tmp_path,
        [
            {"fixture": "two", "title": "A < B", "description": 'Say "hello"'},
            {"fixture": "one", "title": "First", "description": "Description"},
        ],
    )
    calls: list[list[str]] = []
    monkeypatch.setattr(BUILD_SHOWCASES.subprocess, "run", lambda command, check: calls.append(command))

    BUILD_SHOWCASES.build_showcases(output, manifest, template, fixtures)

    index = (output / "index.html").read_text()
    assert index.index('href="two.html"') < index.index('href="one.html"')
    assert "A &lt; B" in index
    assert "Say &quot;hello&quot;" in index
    assert [Path(call[6]).name for call in calls] == ["two.html", "one.html"]


@pytest.mark.parametrize(
    ("records", "message"),
    [
        ([{"fixture": "../one", "title": "x", "description": "y"}], "unsafe"),
        ([{"fixture": "one", "title": "x", "description": "y"}] * 2, "duplicate"),
        ([{"fixture": "missing", "title": "x", "description": "y"}], "does not exist"),
        ([{"fixture": "one", "title": " ", "description": "y"}], "blank"),
    ],
)
def test_load_showcases_invalid_records_fail(tmp_path: Path, records: object, message: str) -> None:
    manifest, _, fixtures, _ = _write_inputs(tmp_path, records)

    with pytest.raises(ValueError, match=message):
        BUILD_SHOWCASES._load_showcases(manifest, fixtures)


def test_load_showcases_malformed_manifest_fails(tmp_path: Path) -> None:
    manifest, _, fixtures, _ = _write_inputs(tmp_path, [])
    manifest.write_text("{")

    with pytest.raises(json.JSONDecodeError):
        BUILD_SHOWCASES._load_showcases(manifest, fixtures)


def test_build_showcases_render_failure_is_nonzero(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    manifest, template, fixtures, output = _write_inputs(
        tmp_path, [{"fixture": "one", "title": "One", "description": "Description"}]
    )

    def fail_render(command: list[str], check: bool) -> None:
        raise subprocess.CalledProcessError(1, command)

    monkeypatch.setattr(BUILD_SHOWCASES.subprocess, "run", fail_render)

    with pytest.raises(subprocess.CalledProcessError):
        BUILD_SHOWCASES.build_showcases(output, manifest, template, fixtures)


def test_build_showcases_real_selection_creates_linked_reports(tmp_path: Path, require_template: None) -> None:
    output = tmp_path / "public"

    result = subprocess.run(
        ["python", str(SCRIPT), str(output)],
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    for name in ("manual-drift", "wheel-bump"):
        assert (output / f"{name}.html").is_file()
        assert f'href="{name}.html"' in (output / "index.html").read_text()


def test_golden_discovery_includes_unselected_fixture() -> None:
    golden = Path(__file__).parent.parent / "fixtures" / "golden"
    selected = {
        item["fixture"]
        for item in BUILD_SHOWCASES._load_showcases(
            Path(__file__).parent.parent / "fixtures" / "showcases.json", golden
        )
    }
    discovered = {path.parent.name for path in golden.glob("*/plan.json")}

    assert "task-dag-rewiring" in discovered
    assert "task-dag-rewiring" not in selected
