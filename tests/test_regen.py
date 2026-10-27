"""Offline safety tests for supervised fixture regeneration guards."""

import os
import subprocess
from pathlib import Path

REPO_ROOT = Path(__file__).parent.parent
REGEN_SCRIPT = REPO_ROOT / "fixtures" / "tooling" / "regen.sh"


def _run_regen(tmp_path: Path, argument: str) -> subprocess.CompletedProcess[str]:
    golden_dir = tmp_path / "fixtures" / "golden"
    (golden_dir / "manual-drift" / "before").mkdir(parents=True)
    (golden_dir / "manual-drift" / "README.md").write_text("manual steps\n")
    (golden_dir / "cleanup-job-run-triggers" / "before").mkdir(parents=True)
    (golden_dir / "cleanup-job-run-triggers" / "README.md").write_text("manual steps\n")
    calls = tmp_path / "databricks-calls"
    executable = tmp_path / "bin" / "databricks"
    executable.parent.mkdir()
    executable.write_text(f"#!/bin/sh\necho called >> '{calls}'\nexit 99\n")
    executable.chmod(0o755)
    script = tmp_path / "regen.sh"
    script_text = REGEN_SCRIPT.read_text().replace('GOLDEN_DIR="$SCRIPT_DIR/../golden"', f'GOLDEN_DIR="{golden_dir}"')
    script.write_text(script_text)
    script.chmod(0o755)
    return subprocess.run(
        [str(script), argument],
        capture_output=True,
        text=True,
        env={**os.environ, "PATH": f"{executable.parent}:{os.environ['PATH']}"},
        check=False,
    )


def test_regen_named_supervised_fixtures_refuse_before_databricks(tmp_path: Path) -> None:
    for name in ("manual-drift", "cleanup-job-run-triggers"):
        result = _run_regen(tmp_path / name, name)

        assert result.returncode == 2
        assert f"fixtures/golden/{name}/README.md" in result.stderr
        assert not (tmp_path / name / "databricks-calls").exists()


def test_regen_all_skips_supervised_fixtures_without_databricks(tmp_path: Path) -> None:
    result = _run_regen(tmp_path, "--all")

    assert result.returncode == 0
    assert "[manual-drift] Skipping interactive fixture." in result.stdout
    assert "[cleanup-job-run-triggers] Skipping interactive fixture." in result.stdout
    assert "fixtures/golden/cleanup-job-run-triggers/README.md" in result.stderr
    assert not (tmp_path / "databricks-calls").exists()
