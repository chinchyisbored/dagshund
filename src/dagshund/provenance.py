from dataclasses import dataclass, field
from datetime import UTC, datetime

from dagshund import __version__
from dagshund.model import Plan


@dataclass(frozen=True, slots=True)
class PlanSource:
    source_name: str
    source_modified_at: str | None


@dataclass(frozen=True, slots=True)
class RawPlanInput:
    raw_bytes: bytes = field(repr=False)
    source: PlanSource | None


@dataclass(frozen=True, slots=True)
class HtmlProvenance:
    source_name: str
    source_modified_at: str | None
    source_plan_sha256: str
    dagshund_version: str
    plan_cli_version: str | None


def format_source_modified_at(timestamp: float) -> str:
    return datetime.fromtimestamp(timestamp, tz=UTC).isoformat().replace("+00:00", "Z")


def build_html_provenance(source: PlanSource, source_plan_sha256: str, plan: Plan) -> HtmlProvenance:
    return HtmlProvenance(
        source_name=source.source_name,
        source_modified_at=source.source_modified_at,
        source_plan_sha256=source_plan_sha256,
        dagshund_version=__version__,
        plan_cli_version=plan.cli_version,
    )
