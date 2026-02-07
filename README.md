# Dagshund

Interactive web-based visualizer for `databricks bundle plan -o json` output.
Shows job task DAGs with diff highlighting for added, removed, modified, and unchanged resources.

## Prerequisites

- [Bun](https://bun.com) v1.3.8+

## Getting Started

```bash
bun install
```

## Development

```bash
bun run dev        # Start dev server with hot reload (http://localhost:3000)
bun run lint       # Check code with Biome
bun run lint:fix   # Auto-fix lint issues
bun run test       # Run tests
bun run build      # Production build to dist/
```

## Production

```bash
bun run build      # Build for production
bun run start      # Serve production build
```

## Structural Diff

Clicking a modified node in the DAG opens a detail panel showing per-field structural diffs — not raw JSON dumps, but smart comparisons that surface only the meaningful deltas.

### Diff Modes

Each field in a resource change is diffed according to its value type:

- **Scalar** — shows old value (red) and new value (green) side by side
- **Array** — matches elements between old and new, then shows each as added (`+`), removed (`-`), or unchanged
- **Object** — compares keys between old and new, showing each key as added, removed, changed (old → new), or unchanged
- **Create-only** — new resource with no baseline; entire value shown in green
- **Delete-only** — removed resource; entire value shown in red

Changed and added entries sort to the top so you see what matters first.

### Identity Key Heuristic

When diffing arrays of objects, the engine auto-detects an **identity key** to match elements between the old and new arrays. It scans all string-valued keys across both arrays and picks the one that:

1. Has unique values within each array (no duplicates in old, no duplicates in new)
2. Appears in the most total elements across both arrays
3. Is present in at least 2 elements total

For example, in a `depends_on` array where each element has a `task_key` field, the engine detects `task_key` as the identity key and uses it to match elements. This means adding a new dependency shows up as a single `+ { task_key: "new_task", ... }` line rather than a confusing reshuffle of the whole array.

When no suitable identity key exists (e.g. arrays of scalars or objects without a unique string key), the engine falls back to deep-equality matching.

### Identity Label Annotation

When an array element is added or removed and was matched via an identity key, the UI annotates it with the key-value pair used for identification. For example:

```
+ { task_key: "check_referential_integrity", ... }  (task_key=check_referential_integrity)
```

The `(task_key=check_referential_integrity)` label tells you which value was used to identify this element as a new addition (or removal). Unchanged elements don't show the label to reduce noise.

### Remote Fallback

When a resource has no `old` value in the plan output (e.g. it was never previously deployed), the diff engine falls back to comparing against the `remote` value instead. When this happens, the UI shows a `(vs remote)` indicator above the diff so you know the baseline isn't the last-deployed state but the current remote state.
