"""Build the offline showcase gallery and its selected HTML reports."""

import argparse
import html
import json
import re
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
MANIFEST_PATH = REPO_ROOT / "fixtures" / "showcases.json"
TEMPLATE_PATH = REPO_ROOT / "docs" / "pages" / "index.html"
FIXTURE_DIRECTORY = REPO_ROOT / "fixtures" / "golden"


def _load_showcases(manifest_path: Path, fixture_directory: Path) -> list[dict[str, str]]:
    data = json.loads(manifest_path.read_text(encoding="utf-8"))
    if not isinstance(data, list):
        raise ValueError("showcase manifest must be a JSON array")
    showcases: list[dict[str, str]] = []
    seen: set[str] = set()
    for index, item in enumerate(data):
        if not isinstance(item, dict) or set(item) != {"fixture", "title", "description"}:
            raise ValueError(f"showcase entry {index} must contain exactly fixture, title, and description")
        fixture, title, description = item["fixture"], item["title"], item["description"]
        if not all(isinstance(value, str) for value in (fixture, title, description)):
            raise ValueError(f"showcase entry {index} fields must be strings")
        if not re.fullmatch(r"[A-Za-z0-9_-]+", fixture):
            raise ValueError(f"unsafe showcase fixture name: {fixture!r}")
        if fixture in seen:
            raise ValueError(f"duplicate showcase fixture: {fixture}")
        if not title.strip() or not description.strip():
            raise ValueError(f"showcase entry {index} title and description must not be blank")
        if not (fixture_directory / fixture / "plan.json").is_file():
            raise ValueError(f"showcase plan does not exist: {fixture_directory / fixture / 'plan.json'}")
        seen.add(fixture)
        showcases.append({"fixture": fixture, "title": title, "description": description})
    return showcases


def _render_cards(showcases: list[dict[str, str]]) -> str:
    return "\n".join(
        f'      <a class="card" href="{html.escape(item["fixture"], quote=True)}.html">\n'
        f'        <div class="card-title">{html.escape(item["title"])}</div>\n'
        f'        <div class="card-desc">{html.escape(item["description"])}</div>\n'
        "      </a>"
        for item in showcases
    )


def build_showcases(output_directory: Path, manifest_path: Path, template_path: Path, fixture_directory: Path) -> None:
    showcases = _load_showcases(manifest_path, fixture_directory)
    template = template_path.read_text(encoding="utf-8")
    marker = "      <!-- showcase-cards -->"
    if template.count(marker) != 1:
        raise ValueError(f"template must contain exactly one {marker!r} insertion point")
    output_directory.mkdir(parents=True, exist_ok=True)
    index = template.replace(marker, _render_cards(showcases))
    (output_directory / "index.html").write_text(index, encoding="utf-8")
    for item in showcases:
        plan_path = fixture_directory / item["fixture"] / "plan.json"
        report_path = output_directory / f"{item['fixture']}.html"
        subprocess.run(
            ["uv", "run", "dagshund", "-q", str(plan_path), "-o", str(report_path)],
            check=True,
        )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output_directory", nargs="?", type=Path, default=Path("public"))
    args = parser.parse_args()
    try:
        build_showcases(args.output_directory, MANIFEST_PATH, TEMPLATE_PATH, FIXTURE_DIRECTORY)
    except (OSError, json.JSONDecodeError, ValueError, subprocess.CalledProcessError) as error:
        print(f"build_showcases: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
