# AGENTS.md — Dagshund

All agents working in this repository MUST follow this file and the referenced guidelines. These are project instructions, not optional background reading.

## Development Tools

- `flake.nix` defines the development toolchain.
- `.envrc` loads the Nix environment through direnv.
- `justfile` provides development commands.
- `process-compose.yaml` manages the CSS watcher and development server, started with `just dev [plan_file]`.

### Fresh checkout

1. Have the user inspect `.envrc` and `flake.nix` and approve `.envrc` with `direnv allow`.
2. Run `direnv exec . just install` to install locked Python and JavaScript dependencies and normal commit hooks.
3. Run `direnv exec . just check` to generate browser assets and verify the checkout. Use `direnv exec . just build` when preparing a wheel, including its bundled skill.

If a command requires authentication or signing, stop and ask the user to handle the prompt. Never approve direnv or change Git/signing settings on the user's behalf.

### Delivery

- Start a feature branch from updated `main`; never commit or push directly to `main`.
- Use Conventional Commits. Pass `just check` before committing and keep normal commit hooks enabled.
- Push the feature branch and open a merge request targeting `main`. The user reviews the pipeline and handles the squash merge; do not merge or monitor CI unless explicitly asked.
- For version bumps, tags, and publication, follow the [release skill](.agents/skills/release/SKILL.md).

### Agent command execution

Agent tool calls may not inherit direnv, even when the user's terminal has loaded it. Always wrap commands explicitly and run from the intended checkout. For example: `direnv exec <checkout> bash -c 'cd <checkout> && just check'`.

`just check` runs `uv run prek run --all-files`; `prek.toml` owns formatting, lint, typechecks, hygiene, browser-template generation, both unit suites, and golden checks. Normal commit hooks run the same suites. Stage intended additions before checking because untracked files are not included. Hooks read current on-disk content and may fix it; inspect and restage fixes, then rerun. Do not commit merely to validate. After success, review the final diff before handoff.

Every change must pass `just check` before handoff. The navigation map below does not select checks: do not substitute focused tools or test subsets for the full gate. Keep prek's native hook summaries; expand successful test output only for diagnosis. Focused helpers are private (hidden from `just --list`) but remain callable. Normal commit hooks enforce the full suite again; do not skip them.

Prek reports hook results and failure diagnostics. When retaining a complete local log, run `direnv exec . bash -c 'mkdir -p .cache && uv run prek run --all-files --verbose > .cache/prek.log 2>&1'` from the intended checkout. Preserve its exit status and inspect the log on failure. Native size checking remains scoped to staged additions; JavaScript lint/format hooks cover `js/src`, `js/tests`, and `js/scripts`, with generated/vendor/style exclusions preserved.

All local repository development and maintenance commands MUST use the repository's direnv environment. This includes Git, `br`, `just`, language tooling, Databricks CLI, GitLab CLI, GitHub CLI, shell utilities, and every command in agent guidelines and skills.

- From the repository root, use `direnv exec . <command> ...`.
- For pipelines, redirection, command substitution, or multiple commands, use `direnv exec . bash -c '<commands>'`.
- `direnv exec` loads the environment but does not change directory. Outside the checkout, use the explicit `cd` pattern above.
- If direnv requires approval, stop and ask the user to inspect and allow `.envrc`; never approve it automatically.
- Never rely on tools inherited from the host environment. Verify required tools are declared in `flake.nix`.

## Project

Python CLI + interactive web visualizer for `databricks bundle plan -o json` output. Distributed via PyPI (`uvx dagshund`). Shows job task DAGs with diff highlighting.

- **Text mode** (default): colored diff summary to terminal
- **Browser mode** (`-o FILE`): interactive DAG visualization as self-contained HTML

## Stack

- **Python** (>=3.12) — CLI, text rendering, zero runtime dependencies
- **TypeScript** (strict) + React 19 + Bun — browser visualization (`js/`)
- React Flow, ELK (elkjs), Tailwind CSS, Zod

## Source navigation

This map locates code; it does not change the required `just check` gate.

| Area | Source |
|---|---|
| CLI, plan parsing, text/HTML output | `src/dagshund/` |
| Browser parsing, preparation, graphs, UI | `js/src/` |
| Build and graph-extraction tooling | `js/scripts/`, `pyproject.toml` |
| Fixture capture and expectation generators | `fixtures/tooling/` |
| Test implementations | `tests/`, `js/tests/` |

### Generated outputs

Edit sources, not generated outputs. These maintenance operations do not replace `just check`; live fixture regeneration and expectation updates still require explicit approval.

| Source | Generated output | Maintenance command |
|---|---|---|
| `js/src/`, `js/scripts/build-template.ts` | `src/dagshund/_assets/template.html` | `just build` |
| `js/src/styles/index.css` | `js/src/styles/output.css` | `just build` |
| `skills/dagshund/SKILL.md` | `src/dagshund/_assets/SKILL.md` | `just build` |
| `fixtures/golden/<name>/plan.json` | `fixtures/golden/<name>/expected*` | `just gen-expected <name>` |

## Code Philosophy (non-negotiable)

Practical functional style. Readable, composable, explicit.

- **Functions over classes.** No inheritance, no OOP patterns. Plain functions, closures, modules. Dataclasses are okay.
- **Immutable by default.** Never mutate data. No singletons, no module-level mutable state.
- **Small and composable.** Under 20 lines target for pure logic functions. Entry-point and orchestration functions (CLI `main`, top-level renderers) may exceed this when splitting would obscure control flow.
- **Descriptive names.** Verb-first (`extract_job_tasks` / `extractJobTaskEdges`, not `get_edges`). No abbreviations.
- No new dependencies without discussion
- No clever one-liners that sacrifice readability
- No modifying production code to make it testable — tests adapt to production, not vice versa
- No skipping error handling: handle it, or track it as a `br` issue.

## Language Guidelines

You MUST load and follow the relevant guideline before changing, reviewing, or discussing code in that area:

- Python code, Python tests, Python packaging, or Python tooling: follow [PYTHON.md](.agents/guidelines/PYTHON.md).
- TypeScript, React, Bun, Zod, graph-building, or frontend utility code: follow [TYPESCRIPT.md](.agents/guidelines/TYPESCRIPT.md).
- Browser UI, React Flow graph behavior, visual styling, screenshots, or interactive visualization work: follow [VISUALIZATION.md](.agents/guidelines/VISUALIZATION.md).
- Any test creation, test edits, fixture expectations, or test review: follow [TESTING.md](.agents/guidelines/TESTING.md).
