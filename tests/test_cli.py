import os
import subprocess
import sys
from io import StringIO
from pathlib import Path

import pytest

from dagshund import DagshundError, __version__
from dagshund.cli import _read_plan, main


def _run_dagshund(*args: str, stdin: str | None = None) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, "-m", "dagshund", *args],
        input=stdin,
        capture_output=True,
        text=True,
    )


# --- subprocess smoke tests (exercises __main__.py + process boundary) ---


def test_main_version_flag_prints_version() -> None:
    result = _run_dagshund("--version")
    assert result.returncode == 0
    assert f"dagshund {__version__}" in result.stdout


def test_main_text_mode_with_file_prints_output(fixtures_dir: Path) -> None:
    result = _run_dagshund(str(fixtures_dir / "complex-plan.json"))
    assert result.returncode == 0
    assert "etl_pipeline" in result.stdout
    assert "create" in result.stdout


# --- _read_plan ---


def test_read_plan_reads_file(tmp_path: Path) -> None:
    plan_file = tmp_path / "plan.json"
    plan_file.write_text('{"plan": {}}')

    assert _read_plan(str(plan_file)) == '{"plan": {}}'


def test_read_plan_file_not_found_raises() -> None:
    with pytest.raises(DagshundError, match="file not found"):
        _read_plan("/nonexistent/plan.json")


@pytest.mark.skipif(os.getuid() == 0, reason="chmod has no effect as root")
def test_read_plan_permission_denied_raises(tmp_path: Path) -> None:
    plan_file = tmp_path / "plan.json"
    plan_file.write_text('{"plan": {}}')
    plan_file.chmod(0o000)
    try:
        with pytest.raises(DagshundError, match="could not read file"):
            _read_plan(str(plan_file))
    finally:
        plan_file.chmod(0o644)


def test_read_plan_non_utf8_file_raises(tmp_path: Path) -> None:
    plan_file = tmp_path / "binary.json"
    plan_file.write_bytes(b"\x80\x81\x82\xff")

    with pytest.raises(DagshundError, match="not valid UTF-8"):
        _read_plan(str(plan_file))


def test_read_plan_directory_raises(tmp_path: Path) -> None:
    with pytest.raises(DagshundError, match="could not read file"):
        _read_plan(str(tmp_path))


def test_read_plan_reads_from_stdin(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("sys.stdin", StringIO('{"plan": {}}'))
    assert _read_plan(None) == '{"plan": {}}'


def test_read_plan_tty_stdin_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("sys.stdin.isatty", lambda: True)
    with pytest.raises(DagshundError, match="no input file specified"):
        _read_plan(None)


# --- main() ---


def test_main_text_mode_with_file(
    monkeypatch: pytest.MonkeyPatch,
    fixtures_dir: Path,
    capsys: pytest.CaptureFixture[str],
) -> None:
    monkeypatch.setattr("sys.argv", ["dagshund", str(fixtures_dir / "complex-plan.json")])

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
    monkeypatch.setattr("sys.argv", ["dagshund", str(fixtures_dir / "complex-plan.json"), "-o", str(output)])

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
        ["dagshund", str(fixtures_dir / "complex-plan.json"), "-o", str(output), "-b"],
    )

    # Pre-import so monkeypatch can target the cached module object.
    # When main() does `import webbrowser` lazily, it gets the same (patched) module.
    import webbrowser

    opened_urls: list[str] = []
    monkeypatch.setattr(webbrowser, "open", lambda url: opened_urls.append(url))

    main()

    assert len(opened_urls) == 1
    assert opened_urls[0].startswith("file://")


def test_main_browser_without_output_exits_with_error(
    monkeypatch: pytest.MonkeyPatch,
    fixtures_dir: Path,
) -> None:
    monkeypatch.setattr("sys.argv", ["dagshund", str(fixtures_dir / "complex-plan.json"), "-b"])

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


def test_main_invalid_json_on_stdin_exits_with_error(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    monkeypatch.setattr("sys.argv", ["dagshund"])
    monkeypatch.setattr("sys.stdin", StringIO("not valid json"))

    with pytest.raises(SystemExit) as exc_info:
        main()

    assert exc_info.value.code == 1
    assert "invalid JSON" in capsys.readouterr().err


def test_main_stdin_with_output_flag_writes_html(
    require_template: None,
    monkeypatch: pytest.MonkeyPatch,
    real_plan_json: str,
    tmp_path: Path,
    capsys: pytest.CaptureFixture[str],
) -> None:
    output = tmp_path / "out.html"
    monkeypatch.setattr("sys.argv", ["dagshund", "-o", str(output)])
    monkeypatch.setattr("sys.stdin", StringIO(real_plan_json))

    main()

    assert output.exists()
    assert "exported to" in capsys.readouterr().out


# --- --detailed-exitcode ---


def test_detailed_exitcode_no_changes_exits_zero(fixtures_dir: Path) -> None:
    result = _run_dagshund(str(fixtures_dir / "no-changes-plan.json"), "--detailed-exitcode")

    assert result.returncode == 0


def test_detailed_exitcode_with_changes_exits_two(fixtures_dir: Path) -> None:
    result = _run_dagshund(str(fixtures_dir / "complex-plan.json"), "--detailed-exitcode")

    assert result.returncode == 2


def test_detailed_exitcode_error_exits_one() -> None:
    result = _run_dagshund("/nonexistent/plan.json", "--detailed-exitcode")

    assert result.returncode == 1


def test_without_detailed_exitcode_changes_exits_zero(fixtures_dir: Path) -> None:
    result = _run_dagshund(str(fixtures_dir / "complex-plan.json"))

    assert result.returncode == 0


# --- --debug ---


def test_debug_flag_traces_all_functions(fixtures_dir: Path) -> None:
    result = _run_dagshund(str(fixtures_dir / "complex-plan.json"), "-d")

    assert result.returncode == 0
    assert "→ _read_plan" in result.stderr
    assert "← _read_plan" in result.stderr
    assert "→ render_text" in result.stderr
    assert "→ _supports_color" in result.stderr
    assert "→ _colorize" in result.stderr
    assert "→ _render_resource" in result.stderr


def test_debug_env_var_traces_all_functions(fixtures_dir: Path) -> None:
    result = subprocess.run(
        [sys.executable, "-m", "dagshund", str(fixtures_dir / "complex-plan.json")],
        capture_output=True,
        text=True,
        env={**os.environ, "DAGSHUND_DEBUG": "1"},
    )

    assert result.returncode == 0
    assert "→ _read_plan" in result.stderr
    assert "→ _supports_color" in result.stderr


def test_no_debug_flag_no_trace_on_stderr(fixtures_dir: Path) -> None:
    result = _run_dagshund(str(fixtures_dir / "complex-plan.json"))

    assert result.returncode == 0
    assert "→" not in result.stderr


# --- subprocess: stdin and --output ---


def test_subprocess_stdin_pipe_prints_text(fixtures_dir: Path) -> None:
    plan_json = (fixtures_dir / "complex-plan.json").read_text()

    result = _run_dagshund(stdin=plan_json)

    assert result.returncode == 0
    assert "etl_pipeline" in result.stdout


def test_subprocess_output_flag_writes_html(require_template: None, fixtures_dir: Path, tmp_path: Path) -> None:
    output = tmp_path / "out.html"

    result = _run_dagshund(str(fixtures_dir / "complex-plan.json"), "-o", str(output))

    assert result.returncode == 0
    assert output.exists()
    assert "exported to" in result.stdout
