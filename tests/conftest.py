from pathlib import Path

import pytest

FIXTURES_DIR = Path(__file__).parent.parent / "fixtures" / "golden"
TEMPLATE_PATH = Path(__file__).parent.parent / "src" / "dagshund" / "_assets" / "template.html"


@pytest.fixture
def fixtures_dir() -> Path:
    return FIXTURES_DIR


@pytest.fixture
def real_plan_json() -> str:
    return (FIXTURES_DIR / "mixed-changes" / "plan.json").read_text()


def skip_without_template() -> None:
    if not TEMPLATE_PATH.exists():
        pytest.skip("template.html not built; run 'just build' first")


@pytest.fixture
def require_template() -> None:
    skip_without_template()
