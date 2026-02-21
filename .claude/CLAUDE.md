# CLAUDE.md — Dagshund 🐕

## Project

A Python CLI tool and interactive web visualizer for `databricks bundle plan -o json` output.
Distributed via PyPI (`uvx dagshund`). Shows job task DAGs with diff highlighting: green for new
resources, red with reduced opacity for deletions, and neutral for unchanged.

Two output modes:
- **Text mode** (default): prints a colored diff summary to the terminal
- **Browser mode** (`-o FILE`): exports an interactive DAG visualization as a self-contained HTML file

## Stack

- **Python** (>=3.10) — CLI, text rendering, zero runtime dependencies
- **TypeScript** (strict mode) + React 19 + Bun — browser visualization (in `js/`)
- React Flow (@xyflow/react) for interactive DAG rendering
- ELK (elkjs) for automatic graph layout
- Tailwind CSS for styling
- Zod for runtime validation of plan JSON input

## Development Commands

```bash
# Python (from repo root)
uv run dagshund --version              # Run the CLI
uv run dagshund plan.json              # Text diff summary (default)
uv run dagshund plan.json -o out.html  # Export interactive HTML
uv run dagshund plan.json -o out.html -b  # Export and open in browser
uv run pytest tests/ -v                # Run Python tests

# JS (via just from repo root)
just install       # bun install in js/
just dev           # Start dev server with hot reload (http://localhost:3000)
just build         # Build JS template + Python wheel
just test-js       # Run JS tests (with coverage)
just lint          # Lint all code (Biome + Ruff)
just typecheck     # Typecheck all code (tsc + ty)

# Combined
just test          # Run both JS and Python tests
just check         # lint + typecheck + all tests
```

## Coding Philosophy — Read This First

I write code in a **functional style**. Not academic Haskell — practical, readable, composable functional code.
These are non-negotiable:

### Immutability by default
- All data structures should be treated as immutable. Use `readonly` on types and interfaces.
- Use `Object.freeze`, spread operators, `map`, `filter`, `reduce` — never mutate in place.
- React state must always be replaced, never mutated.

### Functions over classes
- No classes. Ever. Not for components, not for "services", not for utilities.
- Use plain functions, closures, and modules for organization.
- React components are function components with hooks. No class components.

### Composition over inheritance
- Build complex behavior by composing small, pure functions.
- Use higher-order functions and function composition instead of inheritance hierarchies.
- Prefer `pipe()` / `flow()` patterns for data transformation chains.

### No global mutable state
- Constants and configuration are fine as module-level `const` exports.
- Application state lives in React state (useState, useReducer) or in a reducer pattern.
- No singletons, no mutable module-level variables, no `let` at module scope.

### Explicit over clever
- Prefer verbose and clear over terse and clever.
- Name things descriptively. A function called `extractJobTaskEdges` is better than `getEdges`.
- No abbreviations in variable names unless they're universally understood (e.g., `id`, `url`).

### Type safety
- Use TypeScript's type system aggressively. `unknown` over `any`. Discriminated unions over type assertions.
- Parse, don't validate — use Zod schemas at boundaries, then trust the types internally.
- No type assertions (`as`) unless absolutely unavoidable, and add a comment explaining why.

### Error handling
- Errors should be explicit and visible, never silently swallowed.
- Use Result/Either patterns where appropriate (`{ ok: true, data } | { ok: false, error }`).
- For React: error boundaries at meaningful levels, not just at the root.

### Small functions
- Functions should do one thing. If you need to add "and" to describe what it does, split it.
- Aim for functions under 20 lines. If it's longer, it's probably doing too much.
- Pure functions wherever possible — same input, same output, no side effects.

## File Organization

```
pyproject.toml           — Python package definition
justfile                 — Task runner (just install, just dev, just test, etc.)
src/dagshund/            — Python source
  __init__.py            — Package init + version
  __main__.py            — python -m dagshund support
  cli.py                 — CLI entry point, arg parsing
  browser.py             — HTML template injection + browser opening
  text.py                — Terminal text rendering
  _assets/               — Built artifacts (template.html is gitignored)
js/                      — TypeScript/React source (browser visualization)
  package.json           — JS package definition
  src/                   — TS/TSX source files
    index.ts             — Dev server entry point
    index.html           — HTML template for dev/build
    frontend.tsx         — React entry point
    App.tsx              — Root React component
    cli.ts               — JS CLI for static HTML export
    html-assembler.ts    — Shared HTML assembly (escape helpers, template building)
    parser/              — Plan JSON parsing + Zod validation
    graph/               — DAG graph construction
    components/          — React components (each in its own file)
    types/               — TypeScript types and Zod schemas
    utils/               — Pure utility functions
    hooks/               — Custom React hooks
    styles/              — Tailwind CSS
  tests/                 — JS test files
  test-bundle/           — Shared test fixtures (used by both JS and Python tests)
  scripts/               — Build scripts (build-template.ts)
tests/                   — Python tests
```

Each JS directory should have an `index.ts` barrel export. Keep files small and focused.

## Naming Conventions

- Files: `kebab-case.ts` / `kebab-case.tsx`
- Functions: `camelCase` — verb-first (`parseJobTasks`, `buildEdgeList`, `filterDeletedNodes`)
- Types/interfaces: `PascalCase` with `readonly` fields
- Constants: `SCREAMING_SNAKE_CASE`
- React components: `PascalCase` (function, not class)
- Zod schemas: `camelCase` + `Schema` suffix (`planOutputSchema`, `jobTaskSchema`)

## DAG Visualization Specifics

### Diff States
Each node in the DAG has exactly one diff state:
- `added` — new resource, render with green border/background
- `removed` — deleted resource, render with red border
- `modified` — changed resource, render with amber/yellow indicator
- `unchanged` — no changes, render in neutral/default style

### Interaction Model
- Click a node → slide-in detail panel showing the full diff for that resource
- Hover a node → subtle highlight of its immediate dependencies
- Zoom and pan via React Flow controls

### Data Flow
```
Raw JSON string
  → Zod parse + validate (parser/)
  → Transform to internal graph model (graph/)
  → Convert to React Flow nodes + edges (graph/)
  → Render (components/)
```

Each step is a pure function. No side effects until we hit React rendering.

## Testing

See [TESTING.md](TESTING.md) for full testing guidelines (Python + TypeScript).

Quick summary: standalone functions (no test classes), `test_<function>_<scenario>_<expected>` naming, AAA structure, parametrize for many-input functions, monkeypatch over mocks, no redundant docstrings.

## What NOT To Do

- Don't create class-based abstractions or OOP patterns
- Don't use `any` type
- Don't mutate arrays or objects
- Don't use `var` or reassignable `let` where `const` works
- Don't create god-components — split early and often
- Don't add dependencies without discussing first
- Don't write clever one-liners that sacrifice readability
- Don't use `index` as a React key when items have stable identifiers
- Don't skip error handling "for now" — handle it or explicitly mark it as TODO with a bd issue
