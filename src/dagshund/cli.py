"""CLI entry point for dagshund."""

import argparse
import logging
import os
import sys
from pathlib import Path

from dagshund import DagshundError, __version__, detect_changes, is_resource_changes, parse_plan

EPILOG = """\
examples:
  dagshund plan.json                          text diff summary
  dagshund plan.json -o output.html           export interactive HTML
  dagshund plan.json -o output.html -b        export and open in browser
  databricks bundle plan -o json | dagshund   pipe from Databricks CLI
  cat planfile.json | dagshund                pipe from existing planfile
"""


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="dagshund",
        usage="dagshund [plan_file] [-o OUTPUT] [-b] [-e] [-d]",
        description="Visualize databricks bundle plan output as a colored diff summary",
        epilog=EPILOG,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--version",
        action="version",
        version=f"%(prog)s {__version__}",
    )
    parser.add_argument(
        "plan_file",
        nargs="?",
        help="Path to plan JSON file (reads from stdin if omitted)",
    )
    parser.add_argument(
        "-o",
        "--output",
        help="Export an interactive HTML visualization to this file",
    )
    parser.add_argument(
        "-b",
        "--browser",
        action="store_true",
        help="Open the output file in the default browser (requires -o)",
    )
    parser.add_argument(
        "-d",
        "--debug",
        action="store_true",
        help="Trace dagshund function calls to stderr (also enabled by DAGSHUND_DEBUG env var)",
    )
    parser.add_argument(
        "-e",
        "--detailed-exitcode",
        action="store_true",
        help="Exit 2 if changes detected, 0 if no changes (for CI usage)",
    )
    return parser


def read_plan(plan_file: str | None) -> str:
    """Read plan JSON from file or stdin."""
    if plan_file is not None:
        try:
            with open(plan_file, encoding="utf-8") as f:
                return f.read()
        except FileNotFoundError:
            raise DagshundError(f"file not found: {plan_file}") from None
        except UnicodeDecodeError:
            raise DagshundError(f"file is not valid UTF-8: {plan_file}") from None
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


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()

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

    try:
        raw = read_plan(args.plan_file)
        plan = parse_plan(raw)

        if args.output:
            from dagshund.browser import render_browser

            render_browser(plan, output_path=args.output)

            if args.browser:
                import webbrowser

                webbrowser.open(Path(args.output).resolve().as_uri())
        else:
            from dagshund.text import render_text

            render_text(plan)

        if args.detailed_exitcode:
            resources = plan.get("plan", {})
            if is_resource_changes(resources) and detect_changes(resources):
                sys.exit(2)
    except DagshundError as exc:
        print(f"dagshund: {exc}", file=sys.stderr)
        sys.exit(1)
