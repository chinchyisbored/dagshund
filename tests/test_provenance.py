import pytest
from factories import make_plan

from dagshund import __version__
from dagshund.provenance import (
    HtmlProvenance,
    PlanSource,
    build_html_provenance,
    format_source_modified_at,
)


def test_format_source_modified_at_uses_utc_iso_8601() -> None:
    assert format_source_modified_at(0) == "1970-01-01T00:00:00Z"
    assert format_source_modified_at(1_704_165_600) == "2024-01-02T03:20:00Z"


@pytest.mark.parametrize("cli_version", ["1.14.0", None], ids=["present", "absent"])
def test_build_html_provenance_copies_source_and_plan_metadata(cli_version: str | None) -> None:
    source = PlanSource("plan.json", "2024-01-02T03:20:00Z")
    plan = make_plan(cli_version=cli_version)

    result = build_html_provenance(source, "a" * 64, plan)

    assert result == HtmlProvenance(
        source_name="plan.json",
        source_modified_at="2024-01-02T03:20:00Z",
        source_plan_sha256="a" * 64,
        dagshund_version=__version__,
        plan_cli_version=cli_version,
    )


def test_html_provenance_is_slotted() -> None:
    provenance = HtmlProvenance("stdin", None, "a" * 64, __version__, None)

    assert not hasattr(provenance, "__dict__")
