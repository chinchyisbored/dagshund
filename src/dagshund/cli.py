import argparse
import logging
import os
import sys
from enum import IntEnum
from pathlib import Path

from dagshund import __version__
from dagshund.merge import merge_sub_resources
from dagshund.model import Plan, parse_plan
from dagshund.plan import detect_changes, detect_dangerous_actions, detect_manual_edits
from dagshund.types import DagshundError, DiffState


class ExitCode(IntEnum):
    OK = 0
    ERROR = 1
    CHANGES = 2
    NEEDS_ATTENTION = 3


EPILOG = """\
examples:
  dagshund plan.json                                  terminal diff summary (default)
  dagshund plan.json --format md                      markdown diff summary
  dagshund plan.json -o output.html                   HTML + terminal output
  dagshund plan.json -o output.html -b                HTML + browser + terminal output
  dagshund plan.json -o out.html --format md          HTML file + markdown to stdout
  dagshund plan.json -q -o out.html -e                HTML + exit code, no terminal output
  dagshund plan.json -o r.html --format md -e > s.md  CI: HTML + markdown + exit code
  databricks bundle plan -o json | dagshund           pipe from Databricks CLI
  cat planfile.json | dagshund                        pipe from existing planfile

filter expressions:
  dagshund plan.json -f 'type:jobs'                   show only jobs
  dagshund plan.json -f 'status:added'                show only new resources
  dagshund plan.json -f '"etl_pipeline"'              exact name match
  dagshund plan.json -f 'type:jobs pipeline'          combined: jobs matching "pipeline"
  dagshund plan.json -f 'field:email'                 match field change keys (e.g. task keys)
"""


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="dagshund",
        usage="dagshund [plan_file] [-o OUTPUT] [--format FORMAT] [-q] [-b] [-e] [-d] [-c] [-a] [-m] [-r] [-f FILTER]",
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
        "-q",
        "--quiet",
        action="store_true",
        help="Suppress stdout output",
    )
    output_group.add_argument(
        "-e",
        "--detailed-exitcode",
        action="store_true",
        help="Exit 2 if safe changes, 3 if dangerous actions or drift, 0 if none (for CI)",
    )
    output_group.add_argument(
        "--format",
        choices=["term", "md"],
        default=None,
        help="stdout format (default: term)",
    )

    filter_group = parser.add_argument_group("filters")
    filter_group.add_argument(
        "-c",
        "--changes-only",
        action="store_true",
        help="Show only changed resources (combines -a -m -r)",
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
        help="Filter by search expression ('type:X status:X', 'field:X', '\"exact\"', fuzzy)",
    )
    return parser


def _read_plan(plan_file: str | None) -> str:
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
        "       cat plan.json | dagshund\n"
        "       dagshund <plan.json> --format md"
    )


def _install_skill(target_dir: str) -> None:
    from importlib.resources import files

    source = files("dagshund._assets").joinpath("SKILL.md")
    dest = Path(target_dir) / "dagshund" / "SKILL.md"
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(source.read_text(encoding="utf-8"), encoding="utf-8")
    print(f"dagshund: installed skill to {dest}")


def _build_visible_states(args: argparse.Namespace) -> frozenset[DiffState] | None:
    if args.changes_only:
        return frozenset({DiffState.ADDED, DiffState.MODIFIED, DiffState.REMOVED, DiffState.UNKNOWN})

    states: set[DiffState] = set()
    if args.added:
        states.add(DiffState.ADDED)
    if args.modified:
        states.add(DiffState.MODIFIED)
    if args.removed:
        states.add(DiffState.REMOVED)

    return frozenset(states) if states else None


def _maybe_enable_debug(args: argparse.Namespace) -> None:
    if not (args.debug or os.environ.get("DAGSHUND_DEBUG")):
        return

    logging.basicConfig(
        level=logging.DEBUG,
        format="dagshund: %(message)s",
        stream=sys.stderr,
    )

    from dagshund.debug import enable_profile_tracing

    enable_profile_tracing()


def _validate_args(parser: argparse.ArgumentParser, args: argparse.Namespace) -> None:
    if args.browser and not args.output:
        parser.error("--browser requires --output")

    if args.quiet and args.format is not None:
        parser.error("--quiet and --format are mutually exclusive")

    if args.format is None:
        args.format = "term"


def _render_stdout(
    plan: Plan,
    args: argparse.Namespace,
    visible_states: frozenset[DiffState] | None,
) -> None:
    match args.format:
        case "term":
            from dagshund.terminal import render_text

            render_text(plan, visible_states=visible_states, filter_query=args.filter)
        case "md":
            from dagshund.markdown import render_markdown

            print(render_markdown(plan, visible_states=visible_states, filter_query=args.filter))


def _run(args: argparse.Namespace) -> ExitCode:
    visible_states = _build_visible_states(args)
    raw = _read_plan(args.plan_file)
    plan = parse_plan(raw)

    if args.output:
        from dagshund.browser import render_browser

        render_browser(plan, output_path=args.output)

        if args.browser:
            import webbrowser

            webbrowser.open(Path(args.output).resolve().as_uri())

    if not args.quiet:
        _render_stdout(plan, args, visible_states)

    if not args.detailed_exitcode:
        return ExitCode.OK

    merged = merge_sub_resources(plan.resources)
    if not detect_changes(merged):
        return ExitCode.OK
    if detect_manual_edits(merged) or detect_dangerous_actions(merged):
        return ExitCode.NEEDS_ATTENTION
    return ExitCode.CHANGES


def main() -> None:
    parser = _build_parser()
    args = parser.parse_args()

    if args.install_skill is not None:
        _install_skill(args.install_skill)
        return

    _maybe_enable_debug(args)
    _validate_args(parser, args)

    try:
        sys.exit(_run(args))
    except DagshundError as exc:
        print(f"dagshund: {exc}", file=sys.stderr)
        sys.exit(ExitCode.ERROR)
