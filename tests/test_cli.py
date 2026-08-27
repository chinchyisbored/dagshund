import argparse
import hashlib
import json
import os
import subprocess
import sys
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace
from typing import NoReturn

import pytest

from dagshund import __version__
from dagshund.cli import ExitCode, _build_visible_states, _decode_plan, _read_plan, _run, main
from dagshund.provenance import format_source_modified_at
from dagshund.types import DagshundError, DiffState


def _make_stdin(raw: str | bytes, *, isatty: bool = False) -> SimpleNamespace:
    raw_bytes = raw.encode() if isinstance(raw, str) else raw
    return SimpleNamespace(isatty=lambda: isatty, buffer=BytesIO(raw_bytes))


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
    result = _run_dagshund(str(fixtures_dir / "mixed-changes" / "plan.json"))
    assert result.returncode == 0
    assert "etl_pipeline" in result.stdout
    assert "create" in result.stdout


# --- _read_plan ---


def test_read_plan_reads_file_bytes_and_source_metadata(tmp_path: Path) -> None:
    plan_file = tmp_path / "plan.json"
    plan_file.write_bytes(b'{"plan": {}}')

    result = _read_plan(str(plan_file), include_source_metadata=True)

    assert result.raw_bytes == b'{"plan": {}}'
    assert result.source is not None
    assert result.source.source_name == "plan.json"
    assert result.source.source_modified_at is not None


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


def test_decode_plan_non_utf8_file_raises(tmp_path: Path) -> None:
    plan_file = tmp_path / "binary.json"
    plan_file.write_bytes(b"\x80\x81\x82\xff")
    raw_input = _read_plan(str(plan_file))

    with pytest.raises(DagshundError, match="not valid UTF-8"):
        _decode_plan(raw_input.raw_bytes, str(plan_file))


def test_decode_plan_non_utf8_stdin_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("sys.stdin", _make_stdin(b"\x80\x81\x82\xff"))
    raw_input = _read_plan(None)

    with pytest.raises(DagshundError, match="stdin is not valid UTF-8"):
        _decode_plan(raw_input.raw_bytes, None)


def test_read_plan_directory_raises(tmp_path: Path) -> None:
    with pytest.raises(DagshundError, match="could not read file"):
        _read_plan(str(tmp_path))


def test_read_plan_reads_bytes_from_stdin(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("sys.stdin", _make_stdin(b'{"plan": {}}'))

    result = _read_plan(None, include_source_metadata=True)

    assert result.raw_bytes == b'{"plan": {}}'
    assert result.source is not None
    assert result.source.source_name == "stdin"
    assert result.source.source_modified_at is None


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
    monkeypatch.setattr("sys.argv", ["dagshund", str(fixtures_dir / "mixed-changes" / "plan.json")])

    with pytest.raises(SystemExit) as exc_info:
        main()

    assert exc_info.value.code == 0
    assert "etl_pipeline" in capsys.readouterr().out


def test_main_text_mode_from_stdin(
    monkeypatch: pytest.MonkeyPatch,
    real_plan_json: str,
    capsys: pytest.CaptureFixture[str],
) -> None:
    monkeypatch.setattr("sys.argv", ["dagshund"])
    monkeypatch.setattr("sys.stdin", _make_stdin(real_plan_json))

    with pytest.raises(SystemExit) as exc_info:
        main()

    assert exc_info.value.code == 0
    assert "etl_pipeline" in capsys.readouterr().out


def test_main_output_flag_writes_html(
    require_template: None,
    monkeypatch: pytest.MonkeyPatch,
    fixtures_dir: Path,
    tmp_path: Path,
    capsys: pytest.CaptureFixture[str],
) -> None:
    output = tmp_path / "out.html"
    monkeypatch.setattr("sys.argv", ["dagshund", str(fixtures_dir / "mixed-changes" / "plan.json"), "-o", str(output)])

    with pytest.raises(SystemExit) as exc_info:
        main()

    assert exc_info.value.code == 0
    assert output.exists()
    captured = capsys.readouterr()
    assert "exported to" in captured.err
    assert "etl_pipeline" in captured.out


def test_main_browser_flag_opens_browser(
    require_template: None,
    monkeypatch: pytest.MonkeyPatch,
    fixtures_dir: Path,
    tmp_path: Path,
) -> None:
    output = tmp_path / "out.html"
    monkeypatch.setattr(
        "sys.argv",
        ["dagshund", str(fixtures_dir / "mixed-changes" / "plan.json"), "-o", str(output), "-b"],
    )

    # Pre-import so monkeypatch can target the cached module object.
    # When main() does `import webbrowser` lazily, it gets the same (patched) module.
    import webbrowser

    opened_urls: list[str] = []
    monkeypatch.setattr(webbrowser, "open", lambda url: opened_urls.append(url))

    with pytest.raises(SystemExit) as exc_info:
        main()

    assert exc_info.value.code == 0
    assert len(opened_urls) == 1
    assert opened_urls[0].startswith("file://")


def test_main_browser_without_output_exits_with_error(
    monkeypatch: pytest.MonkeyPatch,
    fixtures_dir: Path,
) -> None:
    monkeypatch.setattr("sys.argv", ["dagshund", str(fixtures_dir / "mixed-changes" / "plan.json"), "-b"])

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


def test_main_install_skill_invalid_destination_exits_with_error(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    capsys: pytest.CaptureFixture[str],
) -> None:
    destination = tmp_path / "not-a-directory"
    destination.write_text("file")
    monkeypatch.setattr("sys.argv", ["dagshund", "--install-skill", str(destination)])

    with pytest.raises(SystemExit) as exc_info:
        main()

    assert exc_info.value.code == ExitCode.ERROR
    assert "could not install skill" in capsys.readouterr().err


def test_main_invalid_json_on_stdin_exits_with_error(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    monkeypatch.setattr("sys.argv", ["dagshund"])
    monkeypatch.setattr("sys.stdin", _make_stdin("not valid json"))

    with pytest.raises(SystemExit) as exc_info:
        main()

    assert exc_info.value.code == 1
    assert "invalid JSON" in capsys.readouterr().err


def test_main_empty_plan_quiet_detailed_exitcode_exits_error(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    monkeypatch.setattr("sys.argv", ["dagshund", "-q", "-e"])
    monkeypatch.setattr("sys.stdin", _make_stdin('{"plan": {}}'))

    with pytest.raises(SystemExit) as exc_info:
        main()

    assert exc_info.value.code == ExitCode.ERROR
    assert "plan is empty" in capsys.readouterr().err


def test_main_broken_pipe_redirects_stdout_and_exits(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    redirected_fds: list[tuple[int, int]] = []

    def raise_broken_pipe(_args: argparse.Namespace) -> ExitCode:
        raise BrokenPipeError

    monkeypatch.setattr("sys.argv", ["dagshund"])
    monkeypatch.setattr("sys.stdout", SimpleNamespace(fileno=lambda: 9))
    monkeypatch.setattr("dagshund.cli._run", raise_broken_pipe)
    monkeypatch.setattr("os.open", lambda _path, _flags: 10)
    monkeypatch.setattr("os.dup2", lambda source, dest: redirected_fds.append((source, dest)))

    with pytest.raises(SystemExit) as exc_info:
        main()

    assert exc_info.value.code == ExitCode.BROKEN_PIPE
    assert redirected_fds == [(10, 9)]


def test_main_stdin_with_output_flag_writes_html(
    require_template: None,
    monkeypatch: pytest.MonkeyPatch,
    real_plan_json: str,
    tmp_path: Path,
    capsys: pytest.CaptureFixture[str],
) -> None:
    output = tmp_path / "out.html"
    monkeypatch.setattr("sys.argv", ["dagshund", "-o", str(output)])
    monkeypatch.setattr("sys.stdin", _make_stdin(real_plan_json))

    with pytest.raises(SystemExit) as exc_info:
        main()

    assert exc_info.value.code == 0
    assert output.exists()
    captured = capsys.readouterr()
    assert "exported to" in captured.err
    assert "etl_pipeline" in captured.out


# --- --detailed-exitcode ---


def test_detailed_exitcode_no_changes_exits_zero(fixtures_dir: Path) -> None:
    result = _run_dagshund(str(fixtures_dir / "no-changes" / "plan.json"), "--detailed-exitcode")

    assert result.returncode == 0


def test_detailed_exitcode_with_safe_changes_exits_two(fixtures_dir: Path) -> None:
    result = _run_dagshund(str(fixtures_dir / "task-dag-rewiring" / "plan.json"), "--detailed-exitcode")

    assert result.returncode == 2


def test_detailed_exitcode_with_dangerous_action_exits_three(fixtures_dir: Path) -> None:
    result = _run_dagshund(str(fixtures_dir / "mixed-changes" / "plan.json"), "--detailed-exitcode")

    assert result.returncode == 3


def test_detailed_exitcode_error_exits_one() -> None:
    result = _run_dagshund("/nonexistent/plan.json", "--detailed-exitcode")

    assert result.returncode == 1


def test_detailed_exitcode_with_manual_edits_exits_three(fixtures_dir: Path) -> None:
    result = _run_dagshund(str(fixtures_dir / "manual-drift" / "plan.json"), "--detailed-exitcode")

    assert result.returncode == 3


def test_detailed_exitcode_with_effect_only_changes_exits_two(fixtures_dir: Path) -> None:
    """All jobs are skip in the job-runs fixture; the deploy still fires runs (dagshund-ocb1)."""
    result = _run_dagshund(str(fixtures_dir / "job-runs" / "plan.json"), "--detailed-exitcode")

    assert result.returncode == 2


def test_without_detailed_exitcode_changes_exits_zero(fixtures_dir: Path) -> None:
    result = _run_dagshund(str(fixtures_dir / "mixed-changes" / "plan.json"))

    assert result.returncode == 0


# --- --debug ---


def test_debug_flag_traces_all_functions(fixtures_dir: Path) -> None:
    result = _run_dagshund(str(fixtures_dir / "mixed-changes" / "plan.json"), "-d")

    assert result.returncode == 0
    assert "→ _read_plan" in result.stderr
    assert "← _read_plan" in result.stderr
    assert "→ render_text" in result.stderr
    assert "→ _supports_color" in result.stderr
    assert "→ _colorize" in result.stderr
    assert "→ _render_resource" in result.stderr


def test_debug_env_var_traces_all_functions(fixtures_dir: Path) -> None:
    result = subprocess.run(
        [sys.executable, "-m", "dagshund", str(fixtures_dir / "mixed-changes" / "plan.json")],
        capture_output=True,
        text=True,
        env={**os.environ, "DAGSHUND_DEBUG": "1"},
    )

    assert result.returncode == 0
    assert "→ _read_plan" in result.stderr
    assert "→ _supports_color" in result.stderr


def test_no_debug_flag_no_trace_on_stderr(fixtures_dir: Path) -> None:
    result = _run_dagshund(str(fixtures_dir / "mixed-changes" / "plan.json"))

    assert result.returncode == 0
    assert "→" not in result.stderr


# --- subprocess: stdin and --output ---


def test_subprocess_stdin_pipe_prints_text(fixtures_dir: Path) -> None:
    plan_json = (fixtures_dir / "mixed-changes" / "plan.json").read_text()

    result = _run_dagshund(stdin=plan_json)

    assert result.returncode == 0
    assert "etl_pipeline" in result.stdout


def test_subprocess_output_flag_writes_html(require_template: None, fixtures_dir: Path, tmp_path: Path) -> None:
    output = tmp_path / "out.html"

    result = _run_dagshund(str(fixtures_dir / "mixed-changes" / "plan.json"), "-o", str(output))

    assert result.returncode == 0
    assert output.exists()
    assert "exported to" in result.stderr
    assert "etl_pipeline" in result.stdout


def test_subprocess_file_output_embeds_exact_bytes_and_basename(require_template: None, tmp_path: Path) -> None:
    plan_file = tmp_path / "source.json"
    output = tmp_path / "out.html"
    raw_bytes = b'{\r\n  "cli_version": "1.14.0",\r\n  "plan": {\r\n    "resources.jobs.etl": {}\r\n  }\r\n}\r\n'
    modified_at = 1_704_165_600
    plan_file.write_bytes(raw_bytes)
    os.utime(plan_file, (modified_at, modified_at))

    result = _run_dagshund(str(plan_file), "-o", str(output))

    assert result.returncode == 0
    content = output.read_text()
    assert '"source_name":"source.json"' in content
    assert f'"source_modified_at":"{format_source_modified_at(modified_at)}"' in content
    assert f'"source_plan_sha256":"{hashlib.sha256(raw_bytes).hexdigest()}"' in content
    assert str(tmp_path) not in content
    normalized_bytes = b'{"cli_version":"1.14.0","plan":{"resources.jobs.etl":{}}}'
    assert hashlib.sha256(normalized_bytes).hexdigest() not in content


@pytest.mark.parametrize(
    "raw_bytes",
    [
        b'{"cli_version":"1.14.0","plan":{"resources.jobs.etl":{}}}',
        b'{\r\n  "cli_version": "1.14.0",\r\n  "plan": {\r\n    "resources.jobs.etl": {}\r\n  }\r\n}\r\n',
    ],
    ids=["compact-whitespace", "crlf-whitespace"],
)
def test_subprocess_stdin_output_embeds_stdin_and_exact_digest(
    require_template: None, tmp_path: Path, raw_bytes: bytes
) -> None:
    output = tmp_path / "out.html"
    expected_plan = {"cli_version": "1.14.0", "plan": {"resources.jobs.etl": {}}}

    assert json.loads(raw_bytes) == expected_plan
    result = _run_dagshund("-o", str(output), stdin=raw_bytes.decode())

    assert result.returncode == 0
    content = output.read_text()
    assert '"source_name":"stdin"' in content
    assert '"source_modified_at":null' in content
    assert f'"source_plan_sha256":"{hashlib.sha256(raw_bytes).hexdigest()}"' in content


@pytest.mark.parametrize("output_format", ["term", "md"], ids=["terminal", "markdown"])
def test_run_non_html_modes_do_not_hash(monkeypatch: pytest.MonkeyPatch, tmp_path: Path, output_format: str) -> None:
    plan_file = tmp_path / "plan.json"
    plan_file.write_bytes(b'{"plan":{"resources.jobs.etl":{}}}')
    args = argparse.Namespace(
        changes_only=False,
        added=False,
        modified=False,
        removed=False,
        plan_file=str(plan_file),
        output=None,
        browser=False,
        quiet=False,
        detailed_exitcode=False,
        format=output_format,
        filter=None,
        suppress_wheel_updates=False,
    )

    def fail_hash(_raw_bytes: bytes) -> NoReturn:
        raise AssertionError("non-HTML mode calculated a source hash")

    def fail_fstat(_file_descriptor: int) -> NoReturn:
        raise AssertionError("non-HTML mode collected source metadata")

    monkeypatch.setattr("dagshund.cli.hashlib.sha256", fail_hash)
    monkeypatch.setattr("dagshund.cli.os.fstat", fail_fstat)

    assert _run(args) == ExitCode.OK


# --- _build_visible_states ---


def test_build_visible_states_no_flags_returns_none() -> None:
    args = argparse.Namespace(changes_only=False, added=False, modified=False, removed=False)
    assert _build_visible_states(args) is None


def test_build_visible_states_changes_only_returns_all_three() -> None:
    args = argparse.Namespace(changes_only=True, added=False, modified=False, removed=False)
    expected = frozenset({DiffState.ADDED, DiffState.MODIFIED, DiffState.REMOVED, DiffState.UNKNOWN})
    assert _build_visible_states(args) == expected


def test_build_visible_states_individual_flags_compose() -> None:
    args = argparse.Namespace(changes_only=False, added=True, modified=False, removed=True)
    assert _build_visible_states(args) == frozenset({DiffState.ADDED, DiffState.REMOVED})


def test_build_visible_states_single_flag() -> None:
    args = argparse.Namespace(changes_only=False, added=False, modified=True, removed=False)
    assert _build_visible_states(args) == frozenset({DiffState.MODIFIED})


def test_build_visible_states_changes_only_overrides_individual() -> None:
    args = argparse.Namespace(changes_only=True, added=True, modified=False, removed=False)
    expected = frozenset({DiffState.ADDED, DiffState.MODIFIED, DiffState.REMOVED, DiffState.UNKNOWN})
    assert _build_visible_states(args) == expected


# --- diff state filter flags ---


def test_changes_only_flag_hides_unchanged(fixtures_dir: Path) -> None:
    result = _run_dagshund(str(fixtures_dir / "mixed-changes" / "plan.json"), "-c")

    assert result.returncode == 0
    assert "alerts/stale_pipeline_alert" in result.stdout
    assert "experiments/audit_analysis_final" in result.stdout
    assert "volumes/old_exports" in result.stdout
    # Individual unchanged resources hidden
    assert "volumes/raw_data" not in result.stdout


def test_added_flag_shows_only_creates(fixtures_dir: Path) -> None:
    result = _run_dagshund(str(fixtures_dir / "mixed-changes" / "plan.json"), "-a")

    assert result.returncode == 0
    assert "experiments/audit_analysis_final" in result.stdout
    assert "alerts/stale_pipeline_alert" not in result.stdout
    assert "volumes/external_imports" not in result.stdout


def test_removed_flag_shows_only_deletes(fixtures_dir: Path) -> None:
    result = _run_dagshund(str(fixtures_dir / "mixed-changes" / "plan.json"), "-r")

    assert result.returncode == 0
    assert "volumes/old_exports" in result.stdout
    assert "experiments/audit_analysis_final" not in result.stdout


def test_modified_flag_shows_only_updates(fixtures_dir: Path) -> None:
    result = _run_dagshund(str(fixtures_dir / "mixed-changes" / "plan.json"), "-m")

    assert result.returncode == 0
    assert "alerts/stale_pipeline_alert" in result.stdout
    assert "experiments/audit_analysis_final" not in result.stdout
    assert "volumes/external_imports" not in result.stdout


def test_flags_compose_added_and_removed(fixtures_dir: Path) -> None:
    result = _run_dagshund(str(fixtures_dir / "mixed-changes" / "plan.json"), "-a", "-r")

    assert result.returncode == 0
    assert "experiments/audit_analysis_final" in result.stdout
    assert "volumes/old_exports" in result.stdout
    assert "alerts/stale_pipeline_alert" not in result.stdout


# --- --filter ---


def test_filter_by_type_shows_only_matching_type(fixtures_dir: Path) -> None:
    result = _run_dagshund(str(fixtures_dir / "mixed-changes" / "plan.json"), "-f", "type:alerts")

    assert result.returncode == 0
    assert "alerts/stale_pipeline_alert" in result.stdout
    assert "jobs" not in result.stdout
    assert "volumes" not in result.stdout


def test_filter_by_status_shows_only_matching_state(fixtures_dir: Path) -> None:
    result = _run_dagshund(str(fixtures_dir / "mixed-changes" / "plan.json"), "-f", "status:added")

    assert result.returncode == 0
    assert "experiments/audit_analysis_final" in result.stdout
    assert "alerts/stale_pipeline_alert" not in result.stdout
    assert "volumes/external_imports" not in result.stdout


def test_filter_fuzzy_matches_resource_name(fixtures_dir: Path) -> None:
    result = _run_dagshund(str(fixtures_dir / "mixed-changes" / "plan.json"), "-f", "pipeline")

    assert result.returncode == 0
    assert "etl_pipeline" in result.stdout
    assert "data_quality_pipeline" in result.stdout
    assert "stale_pipeline_alert" in result.stdout


def test_filter_exact_matches_resource_name(fixtures_dir: Path) -> None:
    result = _run_dagshund(str(fixtures_dir / "mixed-changes" / "plan.json"), "-f", '"etl_pipeline"')

    assert result.returncode == 0
    assert "etl_pipeline" in result.stdout
    assert "data_quality_pipeline" not in result.stdout


def test_filter_composes_with_changes_only(fixtures_dir: Path) -> None:
    result = _run_dagshund(str(fixtures_dir / "mixed-changes" / "plan.json"), "-c", "-f", "type:alerts")

    assert result.returncode == 0
    assert "alerts/stale_pipeline_alert" in result.stdout
    assert "volumes" not in result.stdout
    assert "jobs" not in result.stdout


def test_filter_field_matches_change_keys(fixtures_dir: Path) -> None:
    result = _run_dagshund(str(fixtures_dir / "mixed-changes" / "plan.json"), "-f", "field:email")

    assert result.returncode == 0
    assert "data_quality_pipeline" in result.stdout
    assert "etl_pipeline" in result.stdout
    assert "volumes" not in result.stdout
    assert "alerts" not in result.stdout


def test_filter_no_matches_produces_no_output(fixtures_dir: Path) -> None:
    result = _run_dagshund(str(fixtures_dir / "mixed-changes" / "plan.json"), "-f", "type:nonexistent")

    assert result.returncode == 0
    # Header still prints, but no resource groups
    assert "dagshund plan" in result.stdout
    assert "nonexistent" not in result.stdout


# --- --format md ---


def test_format_md_produces_markdown(fixtures_dir: Path) -> None:
    result = _run_dagshund(str(fixtures_dir / "mixed-changes" / "plan.json"), "--format", "md")

    assert result.returncode == 0
    assert "### dagshund plan" in result.stdout
    assert "`jobs/etl_pipeline`" in result.stdout
    assert "#### jobs" in result.stdout


def test_format_md_no_changes(fixtures_dir: Path) -> None:
    result = _run_dagshund(str(fixtures_dir / "no-changes" / "plan.json"), "--format", "md")

    assert result.returncode == 0
    assert "No changes" in result.stdout


def test_format_md_with_output_produces_both(require_template: None, fixtures_dir: Path, tmp_path: Path) -> None:
    output = tmp_path / "out.html"

    result = _run_dagshund(str(fixtures_dir / "mixed-changes" / "plan.json"), "-o", str(output), "--format", "md")

    assert result.returncode == 0
    assert output.exists()
    assert "### dagshund plan" in result.stdout
    assert "exported to" in result.stderr


def test_format_md_with_detailed_exitcode(fixtures_dir: Path) -> None:
    result = _run_dagshund(str(fixtures_dir / "mixed-changes" / "plan.json"), "--format", "md", "-e")

    assert result.returncode == 3  # dangerous actions present
    assert "### dagshund plan" in result.stdout


def test_format_md_with_changes_only(fixtures_dir: Path) -> None:
    result = _run_dagshund(str(fixtures_dir / "mixed-changes" / "plan.json"), "--format", "md", "-c")

    assert result.returncode == 0
    assert "#### alerts" in result.stdout
    # Individual unchanged resources hidden
    assert "volumes/raw_data" not in result.stdout


def test_format_md_with_filter(fixtures_dir: Path) -> None:
    result = _run_dagshund(str(fixtures_dir / "mixed-changes" / "plan.json"), "--format", "md", "-f", "type:alerts")

    assert result.returncode == 0
    assert "#### alerts" in result.stdout
    assert "#### volumes" not in result.stdout


def test_format_term_explicit_is_default(fixtures_dir: Path) -> None:
    default = _run_dagshund(str(fixtures_dir / "mixed-changes" / "plan.json"))
    explicit = _run_dagshund(str(fixtures_dir / "mixed-changes" / "plan.json"), "--format", "term")

    assert default.stdout == explicit.stdout


def test_format_term_with_output_produces_both(require_template: None, fixtures_dir: Path, tmp_path: Path) -> None:
    output = tmp_path / "out.html"

    result = _run_dagshund(str(fixtures_dir / "mixed-changes" / "plan.json"), "--format", "term", "-o", str(output))

    assert result.returncode == 0
    assert output.exists()
    assert "etl_pipeline" in result.stdout
    assert "exported to" in result.stderr


# --- --quiet ---


def test_quiet_suppresses_stdout(fixtures_dir: Path) -> None:
    result = _run_dagshund(str(fixtures_dir / "mixed-changes" / "plan.json"), "-q")

    assert result.returncode == 0
    assert result.stdout == ""


def test_quiet_with_output_writes_html_only(require_template: None, fixtures_dir: Path, tmp_path: Path) -> None:
    output = tmp_path / "out.html"

    result = _run_dagshund(str(fixtures_dir / "mixed-changes" / "plan.json"), "-q", "-o", str(output))

    assert result.returncode == 0
    assert output.exists()
    assert result.stdout == ""
    assert "exported to" in result.stderr


def test_quiet_with_format_md_errors(fixtures_dir: Path) -> None:
    result = _run_dagshund(str(fixtures_dir / "mixed-changes" / "plan.json"), "-q", "--format", "md")

    assert result.returncode == 2  # argparse error code


def test_quiet_with_format_term_errors(fixtures_dir: Path) -> None:
    result = _run_dagshund(str(fixtures_dir / "mixed-changes" / "plan.json"), "-q", "--format", "term")

    assert result.returncode == 2  # argparse error code


def test_quiet_with_detailed_exitcode(fixtures_dir: Path) -> None:
    result = _run_dagshund(str(fixtures_dir / "mixed-changes" / "plan.json"), "-q", "-e")

    assert result.returncode == 3  # dangerous actions present
    assert result.stdout == ""


# --- --suppress-wheel-updates ---


def test_main_suppress_wheel_updates_flag(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    capsys: pytest.CaptureFixture[str],
) -> None:
    plan_file = tmp_path / "plan.json"
    plan_file.write_text(
        json.dumps(
            {
                "plan": {
                    "resources.jobs.etl": {
                        "action": "update",
                        "changes": {
                            "tasks[task_key='ingest'].libraries[0].whl": {
                                "action": "update",
                                "old": "/Workspace/artifacts/.internal/etl_lib-0.1.0-py3-none-any.whl",
                                "new": "/Workspace/artifacts/.internal/etl_lib-0.2.0-py3-none-any.whl",
                            },
                        },
                    },
                },
            }
        )
    )
    monkeypatch.setattr("sys.argv", ["dagshund", str(plan_file), "--suppress-wheel-updates"])

    with pytest.raises(SystemExit) as exc_info:
        main()

    assert exc_info.value.code == 0
    out = capsys.readouterr().out
    assert "wheel etl_lib updated: 0.1.0 -> 0.2.0 (1 task)" in out
    assert "libraries[0].whl" not in out
