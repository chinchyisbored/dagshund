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

## Commands

All development commands are in the `justfile`. Key ones:

```bash
just install       # bun install, uv sync, prek hooks
just dev           # Dev server (localhost:3000)
just dev-down      # Stop dev server
just build         # JS template + Python wheel
just check         # lint + typecheck + all tests
just test          # All tests (JS + Python)
just lint          # Biome + Ruff (check only)
just typecheck     # tsc + ty
```

## Code Philosophy (non-negotiable)

Practical functional style. Readable, composable, explicit.

- **Immutable by default.** `readonly` types, spread operators, `Object.freeze`. Never mutate. React state is always replaced.
- **Functions over classes.** No exceptions. Plain functions, closures, modules. Function components with hooks.
- **Small and composable.** Under 20 lines. Pure where possible. `pipe()`/`flow()` for chains. No inheritance.
- **Type safety.** `unknown` over `any`. Zod at boundaries, trust types internally. No `as` unless commented why.
- **Explicit errors.** Result/Either patterns. Never silently swallow. Error boundaries at meaningful levels.
- **Descriptive names.** Verb-first (`extractJobTaskEdges` not `getEdges`). No abbreviations.
- **No global mutable state.** React state or reducer patterns only. No singletons, no module-level `let`.

## Naming

- Files: `kebab-case.ts` / `.tsx`
- Functions: `camelCase` verb-first (`parseJobTasks`, `buildEdgeList`)
- Types/interfaces: `PascalCase` with `readonly` fields
- Constants: `SCREAMING_SNAKE_CASE`
- React components: `PascalCase`
- Zod schemas: `camelCase` + `Schema` suffix (`planOutputSchema`)

## Testing

See [TESTING.md](TESTING.md). Standalone functions, `test_<function>_<scenario>_<expected>` naming, AAA, parametrize, monkeypatch over mocks.

## DAG Visualization

See [VISUALIZATION.md](VISUALIZATION.md) when working on the browser UI.

## Don'ts

- No classes, OOP patterns, or `any` type
- No mutation — no `var`, no reassignable `let` where `const` works
- No god-components — split early and often
- No new dependencies without discussion
- No clever one-liners that sacrifice readability
- No `index` as React key when items have stable identifiers
- No skipping error handling — handle it or file a `bd` issue
- No modifying production code to make it testable — tests adapt to production, not vice versa
- No `from __future__ import annotations` — targeting 3.12+
