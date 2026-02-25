@WORKFLOW.md
# CLAUDE.md — Dagshund

## Project

Python CLI + interactive web visualizer for `databricks bundle plan -o json` output.
Distributed via PyPI (`uvx dagshund`). Shows job task DAGs with diff highlighting.

- **Text mode** (default): colored diff summary to terminal
- **Browser mode** (`-o FILE`): interactive DAG visualization as self-contained HTML

## Stack

- **Python** (>=3.12) — CLI, text rendering, zero runtime dependencies
- **TypeScript** (strict) + React 19 + Bun — browser visualization (`js/`)
- React Flow, ELK (elkjs), Tailwind CSS, Zod

## Code Philosophy (non-negotiable)

Practical functional style. Readable, composable, explicit.

- **Functions over classes.** No inheritance, no OOP patterns. Plain functions, closures, modules.
- **Immutable by default.** Never mutate data. No singletons, no module-level mutable state.
- **Small and composable.** Under 20 lines target for pure logic functions. Entry-point and orchestration functions (CLI `main`, top-level renderers) may exceed this when splitting would obscure control flow.
- **Descriptive names.** Verb-first (`extract_job_tasks` / `extractJobTaskEdges`, not `get_edges`). No abbreviations.
- No new dependencies without discussion
- No clever one-liners that sacrifice readability
- No modifying production code to make it testable — tests adapt to production, not vice versa
- No skipping error handling — handle it or file a `br` issue

## Language Guidelines

See [PYTHON.md](.claude/PYTHON.md) when writing or reviewing Python code.
See [TYPESCRIPT.md](.claude/TYPESCRIPT.md) when writing or reviewing TypeScript/React code.
See [VISUALIZATION.md](VISUALIZATION.md) when working on the browser UI.
See [TESTING.md](TESTING.md) when writing tests.
