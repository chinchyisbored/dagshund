# DAG Visualization

Reference for working on the browser UI (`js/src/`).

## Diff States

Each node has exactly one diff state:
- `added` — new resource, green border/background
- `removed` — deleted resource, red border
- `modified` — changed resource, amber/yellow indicator
- `unchanged` — no changes, neutral/default style
- `unknown` — action not recognized or state not derivable, dashed border

## Interaction Model

- Click node → slide-in detail panel with full diff for that resource
- Hover node → subtle highlight of immediate dependencies
- Zoom/pan via React Flow controls

## Data Flow

```
Raw JSON string
  → Zod parse + validate (parser/)
  → Transform to internal graph model (graph/)
  → Convert to React Flow nodes + edges (graph/)
  → Render (components/)
```

Each step is a pure function. No side effects until React rendering.

## Resource Graph Structure

The resource graph groups plan entries into two top-level sections:

- **UC** (`uc-root`) — Unity Catalog hierarchy: catalogs (incl. database/postgres catalogs) → schemas → volumes/models/synced tables, plus inferred source-table phantom leaves
- **Workspace** (`workspace-root`) — everything else, containing:
  - **Lakebase** (`postgres-root`, labeled "Lakebase") — projects → branches → databases/endpoints/roles → synced tables
  - Type categories for flat workspace resource types with at least two real resources, such as **Jobs** or **Pipelines**
  - **Other Resources** (`other-resources-root`) for remaining singleton types and unmatched inferred references whenever a type category or Lakebase exists

Category IDs use `workspace-category::<resource-type>`. Categories are derived from normalized real resource types, and phantom nodes never count toward the threshold for creating one. Matching phantoms join an existing type category. `Other Resources` appears only when a subgroup exists and at least one remaining node needs the fallback; fully flat plans stay directly under Workspace.

Group nodes that represent inferred/external entities (not in the plan) render with dashed borders.

`postgres_catalogs` render as Unity Catalog catalog nodes because that is where users see the
catalog. Their semantic `branch` field is shown as a lateral edge to the Lakebase Postgres branch
when it resolves to a branch resource in the plan.

Branches created from another branch keep their project hierarchy placement. Their semantic
`source_branch` lineage is shown as a lateral edge from the derived branch to the source branch.

## File Structure

```
js/src/
  index.ts              — Dev server entry point
  index.html            — Dev server HTML shell
  frontend.tsx          — React entry point
  app.tsx               — Root React component
  html-assembler.ts     — HTML assembly (escape helpers, template building)
  parser/               — Plan JSON parsing + Zod validation
  graph/                — DAG graph construction
  components/           — React components (each in its own file)
  types/                — TypeScript types and Zod schemas
  utils/                — Pure utility functions
  hooks/                — Custom React hooks
  styles/               — Tailwind CSS
```

The production template is built by `js/scripts/build-template.ts` into `src/dagshund/_assets/`
(the Python package). There are no `index.ts` barrels — import from concrete modules. Keep files
small and focused.
