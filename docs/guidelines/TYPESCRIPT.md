# TypeScript / React Guidelines

## Core Principle

**Pure by default, impure at the boundary.**

All data transformation (parsing, graph building, diffing, formatting) must be pure: no mutation of inputs, no side effects, no I/O. React hooks and components are the impure boundary — effects, refs, event handlers, and state setters are side effects. Minimize their scope: keep logic pure and push the side-effectful shell to the outermost layer.

Local mutation inside a function (e.g., building an array with `.push()`, populating a Map) is acceptable when:
1. the function's signature takes and returns readonly data,
2. the mutation is invisible to callers, and
3. the algorithm genuinely requires it (topological sort, accumulation).

Comment the exception when non-obvious.

## Basics
- **Target**: TypeScript strict mode, React 19, Bun runtime
- **Files**: `kebab-case.ts` / `.tsx`
- **Naming**: `camelCase` verb-first functions (`parseJobTasks`), `PascalCase` types/components, `SCREAMING_SNAKE_CASE` constants
- **Zod schemas**: `camelCase` + `Schema` suffix (`planEntrySchema`). Import from `zod/v4`.

## Data & Types
- **Discriminated unions** for domain variants (`DiffState`, `GraphNode`, `StructuralDiff`). Use a literal string discriminant field (`kind`, `status`, `nodeKind`). Narrow with `if`/`switch` on the discriminant, never `instanceof`. Use a `never` cast in the `default` branch to enforce exhaustive handling — the compiler will error if a new variant is added but not handled.
- **Type composition** via intersection (`&`), not `interface extends`. Supports discriminated unions and avoids interface merging footguns.
- **`readonly` on all type fields.** `Readonly<Record<K, V>>` for static lookup tables. `ReadonlySet<T>` and `ReadonlyMap<K, V>` for computed collections.
- **Zod**: `.readonly()` on all object and array schemas — `z.array(...).readonly()` ensures inferred types are `ReadonlyArray`, preventing accidental `.sort()` / `.push()`. `z.unknown()` for opaque fields (never `z.any()`). Infer types with `z.infer<typeof schema>`. Domain logic depends on the inferred types, never on the Zod schemas themselves — keep Zod at the parse boundary.
- **`as`**: avoid. Permitted for React Flow `node.data` casts (generic doesn't propagate to handlers — comment why) and `as const`. Always comment the reason.

## Functional Patterns
- `.map()`, `.flatMap()`, `.filter()`, `.toSorted()` for data transformation
- `Object.entries()`, `Object.fromEntries()`, `Object.keys()` for record manipulation
- `Set` and `Map` for deduplication and lookup
- Compose via intermediate `const` bindings — no `pipe()`/`flow()` utility needed

## Error Handling
- **`Result<T, E>`** with `ok()`/`err()` for parse and validation functions (pure, explicit error channel)
- **Discriminated union states** (`loading`/`ready`/`error`) for async data in hooks
- Catch at boundaries: hooks catch and set error state, CLI entry points catch and `process.exit(1)`
- Never silently swallow — always log or surface the error

## React Patterns
- Function components only, no class components
- **`memo()`** for graph node components (re-rendered frequently with same props). Skip for components with frequently-changing props.
- **`useCallback`** for all event handlers passed as props
- **Context** (`createContext` + `useFoo()` hook) for cross-cutting state that many descendants need (hover state, value format, job navigation)
- **Refs** for imperative, non-rendering state (React Flow instance, timers, drag state). Refs are the recognized exception to "no mutation" — they are React's escape hatch for imperative code.
- **Cancellation**: `let cancelled = false` in `useEffect` cleanup for async work
- **Props**: `readonly` on every field. No default exports for components.
- **Keys**: prefer stable identifiers. Use index only when elements genuinely lack identity (e.g., lines from `.split("\n")`), with a biome-ignore comment explaining why.
- **State**: always replaced, never mutated. `setState(newValue)`, never `state.push()` or `state.foo = bar`.

## Module Structure
- Barrel exports via `index.ts` in each directory: explicit `export type` for types, `export` for values
- Lazy singleton via closure-scoped IIFE for expensive objects (ELK Worker) — recognized exception to "no singletons"

## Don'ts
- No `var`, no reassignable `let` where `const` works
- No `any` — use `unknown`
- No classes, `interface extends`, or OOP patterns
- No mutation of data structures (except local accumulation inside pure functions)
- No god-components — split early, keep components focused
- No new dependencies without discussion
