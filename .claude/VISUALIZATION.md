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

## File Structure

```
js/src/
  index.ts          — Dev server entry point
  frontend.tsx      — React entry point
  App.tsx           — Root React component
  cli.ts            — JS CLI for static HTML export
  html-assembler.ts — HTML assembly (escape helpers, template building)
  parser/           — Plan JSON parsing + Zod validation
  graph/            — DAG graph construction
  components/       — React components (each in its own file)
  types/            — TypeScript types and Zod schemas
  utils/            — Pure utility functions
  hooks/            — Custom React hooks
  styles/           — Tailwind CSS
```

Each directory has an `index.ts` barrel export. Keep files small and focused.
