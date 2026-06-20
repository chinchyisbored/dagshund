# lakebase-autoscaling

Real Lakebase Autoscaling fixture generated from a Databricks Free Edition
workspace.

This fixture exercises current Lakebase bundle resources:

- `postgres_projects`
- `postgres_branches`
- `postgres_roles`
- `postgres_databases`
- `postgres_endpoints`
- `postgres_catalogs`
- `postgres_synced_tables`

The `before/` state creates project `dagshund`, explicitly manages the
implicitly-created protected `prd` branch, and explicitly manages that branch's
implicit `primary` read-write endpoint with `replace_existing: true`. It also
creates a `data_engineers` Postgres role for the Databricks `data_engineers`
group and an `app_db` database owned by that role.

The `after/` state adds:

- `data_analysts` project access at `CAN_USE`
- `prd` branch protection disabled so bundle destroy can remove the fixture project
- `dev` branch cloned from protected `prd`
- `external-lineage` branch in the external lineage project, cloned from its production branch
- `dev` branch's implicit `primary` read-write endpoint
- Lakebase synced table from `dagshund.phantom_schema.phantom_table` into `app_db`,
  keyed by `tpep_pickup_datetime` and `tpep_dropoff_datetime`
- Unity Catalog Postgres catalog `dagshund_lakebase` bound to the `dev` branch's `app_db`

Regeneration requires Lakebase Autoscaling availability in the target workspace.
The fixture project sets `purge_on_delete: true` so repeated regeneration does
not collide with a soft-deleted `projects/dagshund` project. It also expects
one pre-existing external Lakebase project:

- `projects/phantom-lineage-lakebase` with branch `production`, used for source branch phantom coverage
- `${var.catalog_name}.${var.phantom_schema}.${var.phantom_table}`, used as the Lakebase synced-table source
