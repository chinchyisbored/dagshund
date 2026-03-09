"""CLI entry point for dagshund."""

import argparse
import logging
import os
import sys
from pathlib import Path

from dagshund import DagshundError, DiffState, __version__, detect_changes, is_resource_changes, parse_plan

EPILOG = """\
examples:
  dagshund plan.json                          text diff summary
  dagshund plan.json -o output.html           export interactive HTML
  dagshund plan.json -o output.html -b        export and open in browser
  databricks bundle plan -o json | dagshund   pipe from Databricks CLI
  cat planfile.json | dagshund                pipe from existing planfile

filter expressions:
  dagshund plan.json -f 'type:jobs'           show only jobs
  dagshund plan.json -f 'status:added'        show only new resources
  dagshund plan.json -f '"etl_pipeline"'       exact name match
  dagshund plan.json -f 'type:jobs pipeline'  combined: jobs matching "pipeline"
"""


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="dagshund",
        usage="dagshund [plan_file] [-o OUTPUT] [-b] [-e] [-d] [-c] [-a] [-m] [-r] [-f FILTER]",
        description="Visualize databricks bundle plan output as a colored diff summary",
        epilog=EPILOG,
        formatter_class=lambda prog: argparse.RawDescriptionHelpFormatter(prog, max_help_position=30),
    )
    parser.add_argument(
        "-v",
        "--version",
        action="version",
        version=f"%(prog)s {__version__}",
    )
    parser.add_argument(
        "--install-skill",
        metavar="DIR",
        help="Install the agent skill SKILL.md into DIR/dagshund/ and exit",
    )
    parser.add_argument(
        "plan_file",
        nargs="?",
        help="Path to plan JSON file (reads from stdin if omitted)",
    )
    parser.add_argument(
        "-d",
        "--debug",
        action="store_true",
        help="Trace function calls to stderr",
    )

    output_group = parser.add_argument_group("output")
    output_group.add_argument(
        "-o",
        "--output",
        help="Write interactive HTML visualization to this path",
    )
    output_group.add_argument(
        "-b",
        "--browser",
        action="store_true",
        help="Open output in default browser (requires -o)",
    )
    output_group.add_argument(
        "-e",
        "--detailed-exitcode",
        action="store_true",
        help="Exit 2 if changes detected, 0 if none (for CI)",
    )

    filter_group = parser.add_argument_group("filters")
    filter_group.add_argument(
        "-c",
        "--changes-only",
        action="store_true",
        help="Show only changed resources (shorthand for -a -m -r)",
    )
    filter_group.add_argument(
        "-a",
        "--added",
        action="store_true",
        help="Show only added (created) resources",
    )
    filter_group.add_argument(
        "-m",
        "--modified",
        action="store_true",
        help="Show only modified (updated/recreated/resized) resources",
    )
    filter_group.add_argument(
        "-r",
        "--removed",
        action="store_true",
        help="Show only removed (deleted) resources",
    )
    filter_group.add_argument(
        "-f",
        "--filter",
        metavar="EXPR",
        help='Filter by search expression (type:X status:X "exact" or fuzzy text)',
    )
    return parser


def _read_plan(plan_file: str | None) -> str:
    """Read plan JSON from file or stdin."""
    if plan_file is not None:
        try:
            with open(plan_file, encoding="utf-8") as f:
                return f.read()
        except FileNotFoundError as exc:
            raise DagshundError(f"file not found: {plan_file}") from exc
        except UnicodeDecodeError as exc:
            raise DagshundError(f"file is not valid UTF-8: {plan_file}") from exc
        except OSError as exc:
            raise DagshundError(f"could not read file: {exc}") from exc

    if not sys.stdin.isatty():
        return sys.stdin.read()

    raise DagshundError(
        "no input file specified and stdin is a TTY\n"
        "Usage: dagshund <plan.json>\n"
        "       dagshund <plan.json> -o output.html\n"
        "       cat plan.json | dagshund"
    )


def _install_skill(target_dir: str) -> None:
    """Copy the bundled SKILL.md into target_dir/dagshund/SKILL.md."""
    from importlib.resources import files

    source = files("dagshund._assets").joinpath("SKILL.md")
    dest = Path(target_dir) / "dagshund" / "SKILL.md"
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(source.read_text(encoding="utf-8"), encoding="utf-8")
    print(f"dagshund: installed skill to {dest}")


def _build_visible_states(args: argparse.Namespace) -> frozenset[DiffState] | None:
    """Build the set of visible diff states from CLI flags, or None to show all."""
    if args.changes_only:
        return frozenset({DiffState.ADDED, DiffState.MODIFIED, DiffState.REMOVED})

    states: set[DiffState] = set()
    if args.added:
        states.add(DiffState.ADDED)
    if args.modified:
        states.add(DiffState.MODIFIED)
    if args.removed:
        states.add(DiffState.REMOVED)

    return frozenset(states) if states else None


def main() -> None:
    parser = _build_parser()
    args = parser.parse_args()

    if args.install_skill is not None:
        _install_skill(args.install_skill)
        return

    if args.debug or os.environ.get("DAGSHUND_DEBUG"):
        logging.basicConfig(
            level=logging.DEBUG,
            format="dagshund: %(message)s",
            stream=sys.stderr,
        )

        from dagshund.debug import enable_profile_tracing

        enable_profile_tracing()

    if args.browser and not args.output:
        parser.error("--browser requires --output")

    visible_states = _build_visible_states(args)

    try:
        raw = _read_plan(args.plan_file)
        plan = parse_plan(raw)

        if args.output:
            from dagshund.browser import render_browser

            render_browser(plan, output_path=args.output)

            if args.browser:
                import webbrowser

                webbrowser.open(Path(args.output).resolve().as_uri())
        else:
            from dagshund.text import render_text

            render_text(plan, visible_states=visible_states, filter_query=args.filter)

        if args.detailed_exitcode:
            resources = plan.get("plan", {})
            if is_resource_changes(resources) and detect_changes(resources):
                sys.exit(2)
    except DagshundError as exc:
        print(f"dagshund: {exc}", file=sys.stderr)
        sys.exit(1)
