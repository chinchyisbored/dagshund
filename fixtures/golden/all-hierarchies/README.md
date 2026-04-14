# all-hierarchies (synthetic)

**Do not regenerate with `just regen all-hierarchies` — this fixture has no `before/` or `after/` YAML pair.**

`plan.json` here is hand-authored, not emitted by `databricks bundle plan`. It exists to exercise the widest possible matrix of resource types in one plan so the graph builder, lateral-edge extractor, and renderer are covered for types that are hard to produce in an OSS workspace.

Exotic types covered only by this fixture:

- `catalogs`
- `database_catalogs`, `database_instances`
- `postgres_branches`, `postgres_endpoints`, `postgres_projects`
- `synced_database_tables`
- `external_locations`

Tests that depend on it live in `js/tests/graph/` (`extract-resource-state.test.ts`, `build-resource-graph.test.ts`, `extract-lateral-edges.test.ts`).

**Planned replacement:** tracked in a `br` issue to rebuild this coverage from a real bundle in an enterprise workspace where these resource types are available. Once that lands, this synthetic fixture and its README can be deleted.

Notes:
- `cli_version` is pinned to `0.290.0` (it was authored before the 0.296 bump in sibling fixtures). Leave it unless the test suite tells you otherwise — changing it triggers a golden regeneration of `expected.txt`/`expected.md`/`expected-graph.json`.
- The Pages demo site no longer links to this fixture (card removed from `docs/pages/index.html`), but the CI pages job still generates `public/all-hierarchies.html` by iterating over every fixture dir with a `plan.json`.
