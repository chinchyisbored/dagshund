import re
from pathlib import Path

REPO_ROOT = Path(__file__).parent.parent
FIXTURE_DIR = REPO_ROOT / "fixtures" / "golden" / "retail-de"


def test_named_pipelines_disable_cascading_destroy() -> None:
    for state, expected_pipelines in (
        ("before", {"customer_history", "product_history", "supplier_history", "price_history"}),
        ("after", {"customer_history", "product_history", "supplier_history", "price_history", "store_history"}),
    ):
        configuration = (FIXTURE_DIR / state / "databricks.yaml").read_text()
        pipelines_section = re.search(r"(?ms)^  pipelines:\n(.*?)(?=^  jobs:|\Z)", configuration)
        assert pipelines_section is not None

        for pipeline in expected_pipelines:
            pipeline_block = re.search(rf"(?ms)^    {pipeline}:\n(.*?)(?=^    \w+:|\Z)", pipelines_section.group(1))
            assert pipeline_block is not None
            assert re.search(r"(?m)^      cascade_on_destroy: false$", pipeline_block.group(1))
