# AGENTS.md — Dagshund

All agents working in this repository MUST follow this file and the referenced guidelines. These are project instructions, not optional background reading.

You MUST read and follow [WORKFLOW.md](.agents/guidelines/WORKFLOW.md) before choosing work, creating or updating beads, running quality gates, committing, opening MRs, merging, or closing a session.

## Nix Development Environment

All repository development and maintenance commands MUST run inside the repository's Nix development shell. This includes Git, `br`, `just`, language tooling, Databricks CLI, GitLab CLI, GitHub CLI, shell utilities, and every command in agent guidelines and skills.

- For one-off commands, use `nix develop --command <command> ...`.
- For pipelines, redirection, command substitution, activation, or multiple commands, use `nix develop --command bash -c '<commands>'`.
- A human may run `nix develop` once and then work interactively inside that shell.
- Never rely on tools inherited from the host environment. Verify required tools are declared in `flake.nix`.
- End-user Dagshund usage and the bootstrap `nix develop` command itself are outside this repository-development rule.

## Project

Python CLI + interactive web visualizer for `databricks bundle plan -o json` output. Distributed via PyPI (`uvx dagshund`). Shows job task DAGs with diff highlighting.

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
- No skipping error handling: handle it, or track it as a `br` issue according to [WORKFLOW.md](.agents/guidelines/WORKFLOW.md).

## Language Guidelines

You MUST load and follow the relevant guideline before changing, reviewing, or discussing code in that area:

- Python code, Python tests, Python packaging, or Python tooling: follow [PYTHON.md](.agents/guidelines/PYTHON.md).
- TypeScript, React, Bun, Zod, graph-building, or frontend utility code: follow [TYPESCRIPT.md](.agents/guidelines/TYPESCRIPT.md).
- Browser UI, React Flow graph behavior, visual styling, screenshots, or interactive visualization work: follow [VISUALIZATION.md](.agents/guidelines/VISUALIZATION.md).
- Any test creation, test edits, fixture expectations, or test review: follow [TESTING.md](.agents/guidelines/TESTING.md).
