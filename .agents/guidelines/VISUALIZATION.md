# DAG Visualization

Reference for working on the browser UI (`js/src/`).

## Diff States

Each node has exactly one diff state:
- `added` — new resource, green border/background
- `removed` — deleted resource, red border
- `modified` — changed resource, amber/yellow indicator
- `unchanged` — no changes, neutral/default style
- `unknown` — action not recognized or state not derivable, dashed border

Diff state, drift, and node provenance are separate dimensions. Drift is flagged independently
of diff state and uses dashed borders. Phantom nodes also use dashed borders. A dashed border
alone therefore does not identify an external entity: it can indicate unknown state, drift,
or phantom provenance.

## Interaction Model

- Click a non-root node → center the viewport and open its detail panel with resource diff or inference context
- Click a root node → center the viewport and clear selection without opening details
- Hover node → emphasize the node and immediate neighbors in both directions along visible edges, plus child tasks for job containers; dim unrelated nodes
- Zoom/pan via React Flow controls

## Data Flow

`App` acquires an embedded plan or fetches the `/api/plan` response through `useStdinPlan`;
the server supplies that response from its input. It displays loading, empty, or error states. A
ready plan passes through these distinct stages:

1. **Parse and redact** — `parser/parse-plan.ts` decodes JSON text when needed, validates it
   with Zod, and returns a `Plan`. `redactUcSecretValues` redacts supported Unity Catalog
   secret resource values and secret change payloads before they reach the UI.
2. **Normalize once** — `utils/normalize-plan.ts` folds job-run effect entries into their target
   jobs and associates effects/orphans. It returns a `NormalizedPlan`; it does not mutate the
   parsed plan.
3. **Prepare once** — `preparation/prepare-plan.ts` selects each entry's effective current
   snapshot and projects only the fields consumed by graph builders into `PreparedPlan`. The
   normalized entries remain available alongside those projections. Neither preparation nor
   normalization mutates its input.
4. **Resolve identities and assemble graphs** — `graph/build-plan-graph.ts` and
   `graph/build-resource-graph.ts` build graph nodes and hierarchy edges. The resource graph
   builds one identity catalog, then `graph/resolve-references.ts` composes conventional,
   Postgres, UC-table, derived-output, ingestion, serving, app, task, Lakebase, and workspace
   reference owners. Graph assembly materializes permitted phantom and derived nodes and emits
   resolved lateral edges. These transformations are pure.
5. **Layout asynchronously** — `hooks/use-plan-graph.ts` or `hooks/use-resource-graph.ts`
   invokes `hooks/use-async-layout.ts`. `graph/layout-graph.ts` converts the graph to ELK input,
   runs asynchronous ELK layout, then creates React Flow nodes and edges. Layout is the
   effectful computation; the hook handles loading/error state and ignores stale results after
   cleanup.
6. **Render** — `app.tsx` passes the parsed `Plan` through `PlanContext` and renders the jobs
   and resources views. Components render the resulting layout; UI effects belong in effects or
   event handlers, not render-time transformations.

The parser's `Plan` in `PlanContext` is the original parsed, redacted, pre-normalization plan.
Keep it for historical diff/API-identity access; do not replace it with normalized or prepared
entries. Graph builders consume `PreparedPlan` for current-state semantics and narrow reference
projections.

Preparation selects one effective snapshot per entry, rather than falling back field by field:
non-delete entries use `new_state` when it contains a value, otherwise use `remote_state`; deletes
use `remote_state`. A present empty `new_state.value` is an explicit empty current state, while an
absent snapshot is absent. A malformed state wrapper can fall back to remote state, but an invalid
current-state shape becomes unsupported. Historical diff and API identity extraction may still
read the original entry where explicitly required; that is not current-state fallback.

Prepared capabilities distinguish `supported`, `absent`, and `unsupported`. Preparation keeps
arbitrary resource state and unknown fields opaque; it validates only the narrow shapes needed
for a projection, not a complete Databricks resource schema. Unsupported projections produce
safe diagnostics with a resource key, capability, and reason, not raw state values. The UI renders
these as plan warnings in `components/preparation-diagnostics.tsx`; unsupported data remains
uninterpreted rather than guessed.

## Resource Graph Structure

Lateral edges point from the dependent resource to its dependency. Hierarchy edges point from
parent to child. Derived-output ownership edges point from the output to its owning plan entry.
Keep these meanings distinct when adding relationships. `depends_on` deployment-order references
are not graph edges by themselves; use hierarchy or a semantic lateral relationship.

The resource graph has Unity Catalog and Workspace sections. UC catalogs (including database and
Postgres catalogs) contain schemas, volumes, registered models, and synced-table leaves. Inferred
source-table references can appear as phantom leaves. Managed derived UC synced tables and pipeline
event logs are real derived outputs, not phantoms.

Workspace contains Lakebase (the Postgres project → branch → database/endpoint/role hierarchy),
flat resource types grouped into categories when at least two entries of that type are present,
and `Other Resources` when a subgroup exists and remaining nodes need a fallback. Managed derived
workspace outputs currently count with plan entries when deciding whether a type category repeats.
Phantoms never create a category, though a phantom of a type with an existing category can join it.
`Other Resources` is omitted when no remaining nodes need it; fully flat plans stay directly under
Workspace. Category IDs use `workspace-category::<resource-type>`.

Phantom nodes represent unresolved external entities and use inferred placement and dashed
styling. Derived nodes represent outputs managed by another plan entry: they use ordinary resource
styling, inherit the owner's diff state (including `unknown`), and link laterally from output to
owner without copying the owner's plan state. `graph/derived-node-specs.ts` defines supported
derived outputs and identity conventions. For example, `pipelines[].event_log` creates a derived
Delta-table leaf under its configured catalog/schema, promotes a matching inferred source-table
phantom, and links output to pipeline. `postgres_synced_tables` can produce a managed Workspace
pipeline. Pipeline `catalog`/`target` fields describe output placement, not lateral references;
ingestion source schemas are semantic dependencies and do produce lateral edges.

### Adding a resource reference

1. Add only the consumed, narrow field projection in `preparation/prepare-resource-references.ts`
   or the relevant preparation module. Preserve the `absent` / `supported` / `unsupported`
   result and safe diagnostic behavior.
2. Reuse or add a resource identity convention in `utils/resource-key.ts` or the relevant
   identity/index helper. Use `graph/reference-specs.ts` for conventional reference facts.
3. Add truly resource-specific resolution to its concrete owner: conventional references,
   prepared tasks, workspace, Postgres, Lakebase, UC tables, pipeline ingestion, serving models,
   or app resources. Keep identity catalog construction in `graph/build-reference-identity-catalog.ts`
   and let `graph/resolve-references.ts` compose owners in the established order. Resolve once to
   a `ReferenceResolution`, including its permitted phantom/derived identity and edge direction.
4. Materialize allowed targets during graph assembly, then let
   `graph/extract-lateral-edges.ts` emit deduplicated edges only when both endpoints exist.
5. Cover the public graph behavior and the narrow semantic contract in the relevant tests.
   See [semantic fixture consumers](../../fixtures/README.md#semantic-js-contract-fixtures).

Concrete references and tests include conventional specs and task-reference rules in
`graph/reference-specs.ts` and `graph/resolve-task-references.ts`, domain policies in their
`graph/resolve-*-references.ts` owners, and public outcomes in
`js/tests/graph/reference-outcome-cases.json`. Resolved-target pair deduplication remains in
`graph/extract-lateral-edges.ts` (`js/tests/graph/target-pair-cases.json`). `postgres_roles.membership_roles` intentionally has no
graph edge. Top-level, job, task, and pipeline cluster references resolve symbolic instance-pool
references; concrete instance-pool API IDs remain unsupported. Pipeline catalog/target placement
and monitor output schema do not create graph edges. No claim is made here about CLI 1.20 or AI
Gateway support.

## File Structure

```
js/src/
  index.ts              — Dev server entry point
  index.html            — Dev server HTML shell
  frontend.tsx          — React entry point
  app.tsx               — Root React component and parsed Plan context
  html-assembler.ts     — HTML assembly (escape helpers, template building)
  parser/               — Plan JSON parsing, Zod validation, secret redaction
  preparation/          — Narrow, immutable graph-consumer projections
  graph/                — Identity resolution, graph assembly, ELK layout conversion
  components/           — React components (each in its own file)
  types/                — TypeScript types and Zod schemas
  utils/                — Normalization and shared utilities, including explicit I/O helpers
  hooks/                — Custom React hooks, including acquisition and async layout
  styles/               — Tailwind CSS
```

The production template is built by `js/scripts/build-template.ts` into `src/dagshund/_assets/`
(the Python package). There are no `index.ts` barrels; import from concrete modules. Keep files
small and focused.
