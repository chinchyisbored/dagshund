# Dagshund

Colored diff summaries for `databricks bundle plan -o json` output. Shows what changed, what's new, and what's being deleted — in your terminal or as an interactive HTML report.

## Install

```bash
# Run without installing (ephemeral)
uvx dagshund plan.json

# Persistent install
uv tool install dagshund

# Traditional pip
pip install dagshund
```

## Usage

By default, dagshund prints a colored text diff summary to the terminal:

```bash
dagshund plan.json
```

<!-- TODO: screenshot of terminal output -->

Export an interactive HTML visualization with `-o`:

```bash
dagshund plan.json -o report.html
```

<!-- TODO: screenshot of HTML export -->

Reads from stdin when no file is given, so you can pipe directly from the Databricks CLI:

```bash
databricks bundle plan -o json | dagshund
databricks bundle plan -o json | dagshund -o report.html
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

### Remote Fallback

When a resource has no `old` value in the plan output (e.g. it was never previously deployed), the diff engine falls back to comparing against the `remote` value instead. When this happens, the UI shows a `(vs remote)` indicator above the diff so you know the baseline isn't the last-deployed state but the current remote state.

## Development

### Prerequisites

- [Bun](https://bun.com) v1.3.8+ (for JS/browser visualization development)
- [uv](https://docs.astral.sh/uv/) (for Python package development)
- [just](https://just.systems/) (task runner)

### Setup

```bash
just install       # Install JS dependencies
```

### Commands

```bash
# JS (browser visualization)
just dev           # Dev server with hot reload (http://localhost:3000)
just build         # Production build
just test-js       # Run JS tests
just lint          # Biome lint check
just typecheck     # TypeScript type-check
just template      # Build template.html for Python package

# Python
uv run dagshund --version
uv run pytest tests/ -v

# Combined
just test          # Run both JS and Python tests
just check         # lint + typecheck + all tests
```

### Dev server

Pipe a plan to the dev server for live exploration with hot reload:

```bash
cd js && cat tests/fixtures/complex-plan.json | bun run dev
```

Or start without a plan and upload via the UI:

```bash
just dev
```

## License

MIT
