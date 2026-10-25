# TypeScript / React Guidelines

## Core Principle

**Pure by default, impure at the boundary.**

All data transformation (parsing, graph building, diffing, formatting) must be pure: no mutation of inputs, no side effects, no I/O. Component render bodies and hook render-time logic must also remain pure. Put side effects in event handlers, effects, or explicit I/O boundaries. Keep the side-effectful shell small and at the outermost layer.

Local mutation inside a function (e.g., building an array with `.push()`, populating a Map) is acceptable when:
1. the function's signature takes and returns readonly data,
2. the mutation is invisible to callers, and
3. the algorithm genuinely requires it (topological sort, accumulation).

Comment the exception when non-obvious.

## Basics
- **Target**: TypeScript strict mode, React 19, Bun runtime
- **Files**: `kebab-case.ts` / `.tsx`
- **Naming**: `camelCase` local bindings and verb-first functions (`parseJobTasks`), `PascalCase` types/components, `SCREAMING_SNAKE_CASE` module-level fixed constants
- **Zod schemas**: `camelCase` + `Schema` suffix (`planEntrySchema`). Import from `zod/v4`.

## Data & Types
- **Discriminated unions** for domain variants (`DiffState`, `GraphNode`, `StructuralDiff`). Use a literal string discriminant field (`kind`, `status`, `nodeKind`). Narrow with `if`/`switch` on the discriminant, never `instanceof`. Check exhaustiveness by assigning the remaining value to `never`: `const exhaustive: never = value; return exhaustive;`. Place this after the switch or in its default branch. The compiler will error if a new variant is not handled. Never use `as never`; it bypasses the check.
- **Type composition** via intersection (`&`), not `interface extends`. Supports discriminated unions and avoids interface merging footguns.
- **Registries for per-kind conventions.** Define shared per-kind facts (ID prefix, badge, API-ID index, extractor) once and reuse their builders/lookups. For kind-keyed tables, use `as const satisfies Readonly<Record<string, Spec>>` and derive the kind type with `keyof typeof`; lookups with an unregistered kind must fail to compile. Adding a convention entry must not require duplicating that convention elsewhere. New domain behavior may require additional changes. Use adjacent exhaustive switches when kinds have genuinely different semantics rather than adding flags to force them into one table (`resolveAppRefTargetKey` vs `resolveAppPhantomRef`).
- **Registry examples**: kind-keyed table `PHANTOM_PREFIX_SPECS` and ID builders (`utils/resource-key.ts`); conventional reference facts and task-reference rules (`graph/reference-specs.ts`); derived-output identity and placement conventions (`graph/derived-node-specs.ts`); hierarchy specifications using `ChainSpec` (`graph/hierarchy-specs.ts`). Reference resolution has concrete owners: `graph/build-reference-identity-catalog.ts` builds shared identities, domain modules under `graph/resolve-*-references.ts` resolve relationships, and `graph/resolve-references.ts` composes their results. `graph/extract-lateral-edges.ts` emits resolved, materialized, deduplicated targets; it is not the owner of a relationship registry.
- **`readonly` on all type fields.** `Readonly<Record<K, V>>` for static lookup tables. `ReadonlySet<T>` and `ReadonlyMap<K, V>` for computed collections.
- **Zod**: `.readonly()` on all object and array schemas. It provides readonly inferred types and shallow-freezes that schema's parsed output at runtime. For arrays, it prevents accidental `.sort()` / `.push()`. `z.unknown()` for opaque fields (never `z.any()`). Infer types with `z.infer<typeof schema>`. Domain logic depends on the inferred types, never on the Zod schemas themselves; keep Zod at the parse boundary.
- **`as`**: avoid type assertions. Allowed: `as const` and the documented React Flow `node.data` boundary cast. Explain non-const assertions; routine `as const` needs no comment. If another assertion appears necessary, ask before introducing it. Existing assertions are not permission to add more.

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
- Function components only, except the existing `ErrorBoundary`: React requires a class for `getDerivedStateFromError`. Do not introduce other class components.
- **`memo()`** for graph node components (re-rendered frequently with same props). Skip for components with frequently-changing props.
- **`useCallback`** for all event handlers passed as props
- **Context** (`createContext` + `useFoo()` hook) for cross-cutting state that many descendants need (hover state, value format, job navigation)
- **Refs** for imperative, non-rendering state (React Flow instance, timers, drag state). Refs are the recognized exception to "no mutation" — they are React's escape hatch for imperative code.
- **Cancellation**: async effects must prevent stale results and errors from updating state after cleanup. For non-cancellable work, initialize `let cancelled = false` inside the effect, set it to `true` in cleanup, and guard both success and failure handlers. Abort cancellable operations during cleanup using their supported cancellation API.
- **Props**: `readonly` on every field. No default exports for components.
- **Keys**: prefer stable identifiers. Use index only when elements genuinely lack identity (e.g., lines from `.split("\n")`), with a biome-ignore comment explaining why.
- **State**: always replaced, never mutated. `setState(newValue)`, never `state.push()` or `state.foo = bar`.

## Module Structure
- No barrel files — import directly from the concrete module (`../utils/resource-key.ts`), including the `.ts` extension
- Lazy singleton via closure-scoped IIFE for expensive objects (ELK Worker) — recognized exception to "no singletons"

## Don'ts
- No `var`, no reassignable `let` where `const` works
- No `any` — use `unknown`
- No classes (except the `ErrorBoundary` described above), `interface extends`, or OOP patterns
- No mutation of data structures (except local accumulation inside pure functions)
- No god-components — split early, keep components focused
- No new dependencies without discussion
