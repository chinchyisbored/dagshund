# DAG Visualization

Reference for working on the browser UI (`js/src/`).

## Diff States

Each node has exactly one diff state:
- `added` — new resource, green border/background
- `removed` — deleted resource, red border
- `modified` — changed resource, amber/yellow indicator
- `unchanged` — no changes, neutral/default style

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

The resource graph groups plan entries into four sections:

- **UC** (`uc-root`) — Unity Catalog hierarchy: catalogs → schemas → volumes/models
- **Workspace** (`workspace-root`) — everything else, containing:
  - **Postgres** (`postgres-root`) — projects → branches → endpoints
  - **Lakebase** (`lakebase-root`) — database instances → synced tables
  - **Other Resources** (`other-resources-root`) — flat workspace resources (jobs, alerts, experiments, pipelines, etc.)

The "Other Resources" group only appears when Postgres or Lakebase hierarchies are present — it separates flat resources from the nested hierarchies so ELK produces cleaner layouts. When no hierarchies exist, flat resources connect directly to `workspace-root`.

Group nodes that represent inferred/external entities (not in the plan) render with dashed borders.

## File Structure

```
js/src/
  index.ts              — Dev server entry point
  index.html            — Dev server HTML shell
  frontend.tsx          — React entry point
  app.tsx               — Root React component
  cli.ts                — JS CLI for static HTML export
  html-assembler.ts     — HTML assembly (escape helpers, template building)
  dagshund/_assets/     — Bundled template.html for static HTML export
  parser/               — Plan JSON parsing + Zod validation
  graph/                — DAG graph construction
  components/           — React components (each in its own file)
  types/                — TypeScript types and Zod schemas
  utils/                — Pure utility functions
  hooks/                — Custom React hooks
  styles/               — Tailwind CSS
```

Each directory has an `index.ts` barrel export. Keep files small and focused.
