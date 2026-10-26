### dagshund plan (v2, cli 1.20.0)

#### postgres\_branches (3)
- `+` `postgres_branches/dev_branch` — create
- `+` `postgres_branches/external_lineage_branch` — create
- `~` `postgres_branches/prd_branch` — update
  - `~` `is_protected`: true -&gt; false

#### postgres\_catalogs (1)
- `+` `postgres_catalogs/dev_catalog` — create

#### postgres\_databases (1)
- `=` `postgres_databases/app_database`

#### postgres\_endpoints (2)
- `+` `postgres_endpoints/dev_endpoint` — create
- `=` `postgres_endpoints/prd_endpoint`

#### postgres\_projects (1)
- `~` `postgres_projects/dagshund_project` — update
  - `+` `custom_tags`: \[\{key: "env", value: "prd"\}\]
  - `+` `permissions.[group_name='data_analysts']`: \{level: "CAN\_USE", group\_name: "data\_analysts"\}

#### postgres\_roles (1)
- `=` `postgres_roles/data_engineers`

#### postgres\_synced\_tables (1)
- `+` `postgres_synced_tables/phantom_table` — create
  - `+` managed pipeline: `phantom_table pipeline`
  - `+` managed Unity Catalog registration: `dagshund_lakebase.public.phantom_table`

**+5** create, **=3** unchanged, **~2** update
