import subprocess
import sys
from io import StringIO
from pathlib import Path

import pytest

from dagshund import DagshundError, __version__
from dagshund.cli import main, read_plan


def _run_dagshund(*args: str, stdin: str | None = None) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, "-m", "dagshund", *args],
        input=stdin,
        capture_output=True,
        text=True,
    )


# --- subprocess smoke tests (exercises __main__.py + process boundary) ---


def test_cli_version_flag() -> None:
    result = _run_dagshund("--version")
    assert result.returncode == 0
    assert f"dagshund {__version__}" in result.stdout


def test_cli_text_mode_with_file(fixtures_dir: Path) -> None:
    result = _run_dagshund(str(fixtures_dir / "real_fixture.json"))
    assert result.returncode == 0
    assert "etl_pipeline" in result.stdout
    assert "create" in result.stdout


# --- read_plan ---


def test_read_plan_reads_file(tmp_path: Path) -> None:
    plan_file = tmp_path / "plan.json"
    plan_file.write_text('{"plan": {}}')

    assert read_plan(str(plan_file)) == '{"plan": {}}'


def test_read_plan_file_not_found_raises() -> None:
    with pytest.raises(DagshundError, match="file not found"):
        read_plan("/nonexistent/plan.json")


def test_read_plan_permission_denied_raises(tmp_path: Path) -> None:
    plan_file = tmp_path / "plan.json"
    plan_file.write_text('{"plan": {}}')
    plan_file.chmod(0o000)
    try:
        with pytest.raises(DagshundError, match="could not read file"):
            read_plan(str(plan_file))
    finally:
        plan_file.chmod(0o644)


def test_read_plan_reads_from_stdin(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("sys.stdin", StringIO('{"plan": {}}'))
    assert read_plan(None) == '{"plan": {}}'


def test_read_plan_tty_stdin_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("sys.stdin.isatty", lambda: True)
    with pytest.raises(DagshundError, match="no input file specified"):
        read_plan(None)


# --- main() ---


def test_main_text_mode_with_file(
    monkeypatch: pytest.MonkeyPatch,
    fixtures_dir: Path,
    capsys: pytest.CaptureFixture[str],
) -> None:
    monkeypatch.setattr("sys.argv", ["dagshund", str(fixtures_dir / "real_fixture.json")])

    main()

    assert "etl_pipeline" in capsys.readouterr().out


def test_main_text_mode_from_stdin(
    monkeypatch: pytest.MonkeyPatch,
    real_plan_json: str,
    capsys: pytest.CaptureFixture[str],
) -> None:
    monkeypatch.setattr("sys.argv", ["dagshund"])
    monkeypatch.setattr("sys.stdin", StringIO(real_plan_json))

    main()

    assert "etl_pipeline" in capsys.readouterr().out


def test_main_output_flag_writes_html(
    require_template: None,
    monkeypatch: pytest.MonkeyPatch,
    fixtures_dir: Path,
    tmp_path: Path,
    capsys: pytest.CaptureFixture[str],
) -> None:
    output = tmp_path / "out.html"
    monkeypatch.setattr("sys.argv", ["dagshund", str(fixtures_dir / "real_fixture.json"), "-o", str(output)])

    main()

    assert output.exists()
    assert "exported to" in capsys.readouterr().out


def test_main_browser_flag_opens_browser(
    require_template: None,
    monkeypatch: pytest.MonkeyPatch,
    fixtures_dir: Path,
    tmp_path: Path,
) -> None:
    output = tmp_path / "out.html"
    monkeypatch.setattr(
        "sys.argv",
        ["dagshund", str(fixtures_dir / "real_fixture.json"), "-o", str(output), "-b"],
    )

    # webbrowser is imported lazily inside main(), so monkeypatch can't
    # target it before the import happens — need unittest.mock.patch.
    from unittest.mock import patch

    with patch("webbrowser.open") as mock_open:
        main()

    mock_open.assert_called_once()
    assert mock_open.call_args[0][0].startswith("file://")


def test_main_browser_without_output_exits_with_error(
    monkeypatch: pytest.MonkeyPatch,
    fixtures_dir: Path,
) -> None:
    monkeypatch.setattr("sys.argv", ["dagshund", str(fixtures_dir / "real_fixture.json"), "-b"])

    with pytest.raises(SystemExit) as exc_info:
        main()

    assert exc_info.value.code == 2  # argparse error code


def test_main_dagshund_error_prints_to_stderr_and_exits(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    monkeypatch.setattr("sys.argv", ["dagshund", "/nonexistent/plan.json"])

    with pytest.raises(SystemExit) as exc_info:
        main()

    assert exc_info.value.code == 1
    assert "dagshund:" in capsys.readouterr().err
