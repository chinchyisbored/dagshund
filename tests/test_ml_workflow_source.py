import re
from pathlib import Path

REPO_ROOT = Path(__file__).parent.parent
FIXTURE_DIR = REPO_ROOT / "fixtures" / "golden" / "ml-workflow"


def test_ml_workflow_resources_have_global_keys_and_valid_references() -> None:
    for state in ("before", "after"):
        configuration = (FIXTURE_DIR / state / "databricks.yaml").read_text()
        resource_keys: list[str] = []
        resource_ids: set[tuple[str, str]] = set()
        in_resources = False
        group = ""

        for line in configuration.splitlines():
            if line == "resources:":
                in_resources = True
                continue
            if in_resources and line and not line.startswith(" "):
                break
            group_match = re.fullmatch(r"  ([\w-]+):", line)
            if in_resources and group_match:
                group = group_match.group(1)
            key_match = re.fullmatch(r"    ([\w-]+):", line)
            if in_resources and group and key_match:
                key = key_match.group(1)
                resource_keys.append(key)
                resource_ids.add((group, key))

        assert len(resource_keys) == len(set(resource_keys))
        references = re.findall(r"\$\{resources\.([\w-]+)\.([\w-]+)\.", configuration)
        assert all(reference in resource_ids for reference in references)
