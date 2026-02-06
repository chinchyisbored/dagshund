# CLAUDE.md — Dagshund 🐕

## Project

An interactive web-based visualizer for `databricks bundle plan -o json` output (direct deployment engine).
Shows job task DAGs with diff highlighting: green for new resources, red with reduced opacity for deletions,
and neutral for unchanged. Users can click on nodes to inspect the detailed changes for each resource.

The tool runs locally (`bun run dev`) and accepts plan JSON either via file upload or stdin pipe.

## Stack

- TypeScript (strict mode)
- React 19 + Bun
- React Flow (@xyflow/react) for interactive DAG rendering
- Tailwind CSS for styling
- Zod for runtime validation of plan JSON input

## Development Commands

```bash
bun install        # Install dependencies
bun run dev        # Start dev server with hot reload (http://localhost:3000)
bun run lint       # Check code with Biome (bun run lint:fix to auto-fix)
bun run test       # Run tests (bun run test:watch for watch mode)
bunx tsc --noEmit  # Type-check without emitting
bun run build      # Production build to dist/
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
src/
  parser/        — Parse and validate databricks bundle plan JSON
  graph/         — Transform parsed plan into DAG nodes and edges
  components/    — React components (each in its own file)
  types/         — Shared TypeScript types and Zod schemas
  utils/         — Pure utility functions
  hooks/         — Custom React hooks
  styles/        — Tailwind config, any custom CSS
```

Each directory should have an `index.ts` barrel export. Keep files small and focused.

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
- `removed` — deleted resource, render with red border and 40% opacity
- `modified` — changed resource, render with amber/yellow indicator
- `unchanged` — no changes, render in neutral/default style

### Interaction Model
- Click a node → slide-in detail panel showing the full diff for that resource
- Hover a node → subtle highlight of its immediate dependencies
- Zoom and pan via React Flow controls
- Minimap for orientation in large DAGs

### Data Flow
```
Raw JSON string
  → Zod parse + validate (parser/)
  → Transform to internal graph model (graph/)
  → Convert to React Flow nodes + edges (graph/)
  → Render (components/)
```

Each step is a pure function. No side effects until we hit React rendering.

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
