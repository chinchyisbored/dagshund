"""CLI entry point for dagshund."""

import argparse
import sys

from dagshund import DagshundError, __version__


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="dagshund",
        description="Visualize databricks bundle plan output as a colored diff summary",
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
    return parser


def read_plan(plan_file: str | None) -> str:
    """Read plan JSON from file or stdin."""
    if plan_file is not None:
        try:
            with open(plan_file) as f:
                return f.read()
        except FileNotFoundError:
            raise DagshundError(f"file not found: {plan_file}") from None
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

    try:
        raw = read_plan(args.plan_file)

        if args.output:
            from dagshund.browser import render_browser

            render_browser(raw, output_path=args.output)
        else:
            from dagshund.text import render_text

            render_text(raw)
    except DagshundError as exc:
        print(f"dagshund: {exc}", file=sys.stderr)
        sys.exit(1)
