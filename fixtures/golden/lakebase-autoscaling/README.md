# lakebase-autoscaling

Real Lakebase Autoscaling fixture generated from a Databricks Free Edition
workspace.

This fixture exercises current Lakebase bundle resources:

- `postgres_projects`
- `postgres_branches`
- `postgres_endpoints`
- `postgres_catalogs`

The `before/` state creates project `dagshund`, explicitly manages the
implicitly-created protected `prd` branch, and explicitly manages that branch's
implicit `primary` read-write endpoint with `replace_existing: true`.

The `after/` state adds:

- `data_analysts` project access at `CAN_USE`
- `dev` branch cloned from protected `prd`
- `external-lineage` branch in the external lineage project, cloned from its production branch
- `dev` branch's implicit `primary` read-write endpoint
- read-only `dagshund-reader` endpoint on an external Lakebase branch
- Unity Catalog Postgres catalog `dagshund_lakebase` bound to the `dev` branch

Regeneration requires Lakebase Autoscaling availability in the target workspace.
It also expects two pre-existing external Lakebase projects:

- `projects/phantom-lakebase` with branch `production`, used for endpoint parent phantom coverage
- `projects/phantom-lineage-lakebase` with branch `production`, used for source branch phantom coverage

Because `prd` is protected, `regen.sh` has fixture-specific cleanup that
temporarily unprotects it before `bundle destroy`. The script then purges the
soft-deleted `projects/dagshund` project so the fixture can be regenerated
again immediately.
