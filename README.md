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

## CI Exit Codes

Use `--detailed-exitcode` (or `-e`) to get machine-readable exit codes for CI pipelines:

```bash
dagshund plan.json -e
```

| Exit Code | Meaning |
|-----------|---------|
| 0 | Plan parsed, no changes detected |
| 1 | Error (bad input, missing file, etc.) |
| 2 | Plan parsed, changes detected |

Works with both text and HTML output modes:

```bash
# Text mode — check for drift
dagshund plan.json -e
if [ $? -eq 2 ]; then echo "Drift detected"; fi

# HTML mode — generate report AND get exit code
dagshund plan.json -o report.html -e
```

Without `-e`, dagshund always exits 0 on success (existing behavior).

## Resource Graph

The HTML report organizes resources into visual groups:

- **Unity Catalog** — catalogs, schemas, volumes, and registered models in their catalog/schema hierarchy
- **Postgres** — projects, branches, and endpoints
- **Lakebase** — database instances and synced tables
- **Other Resources** — everything else (jobs, alerts, experiments, pipelines, etc.)

When your plan includes Postgres or Lakebase resources alongside jobs and other flat resources, dagshund wraps the flat resources in an "Other Resources" group to keep the layout clean. If your plan has no Postgres or Lakebase resources, flat resources appear directly under the workspace root without the extra grouping.

### Phantom Nodes

Some resources in the graph won't exist in your bundle plan. When dagshund encounters a reference to a resource that isn't directly managed — like an endpoint pointing to a branch that isn't in your plan, or a volume belonging to a schema you didn't define — it creates a **phantom node** to fill in the gap. These appear with dashed borders and represent dagshund's best guess at the surrounding hierarchy, interpolated from resource paths in the plan.

This gives you a complete picture of how your resources relate to each other, even when parts of the tree live outside your bundle. Phantom nodes are inferred, not authoritative — they reflect what the plan references, not what actually exists in your workspace.

### Resource Links

Many resources reference each other across hierarchies — synced tables point to database instances, alerts reference SQL warehouses, serving endpoints bind to registered models, pipelines write to catalogs and schemas. These cross-references are hidden in the default hierarchy view.

Toggle **Links** in the toolbar to overlay these lateral edges on the graph. They appear as dashed blue lines connecting the source resource to its target, without disturbing the hierarchy layout. The toggle only appears when cross-references exist in your plan.

<!-- TODO: screenshot of resource links overlay -->

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
just dev           # Dev server with hot reload (http://localhost:3000)
just dev-down      # Stop dev server
just build         # JS template + Python wheel
just test          # All tests (JS + Python)
just test-js       # JS tests only
just check         # lint + typecheck + all tests
just lint          # Biome + Ruff (check only)
just typecheck     # tsc + ty
```

### Dev server

Start the dev server with a plan piped via stdin (defaults to `fixtures/complex-plan.json`):

```bash
just dev                          # uses default fixture
just dev path/to/your/plan.json   # use a specific plan, relative to justfile location
just dev-down                     # stop the server
```

## License

MIT
