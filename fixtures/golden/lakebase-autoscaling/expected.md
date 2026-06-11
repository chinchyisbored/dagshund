### dagshund plan (v2, cli 1.3.0)

#### postgres_branches (3)
- `+` `postgres_branches/dev_branch` — create
- `+` `postgres_branches/external_lineage_branch` — create
- `~` `postgres_branches/prd_branch` — update
  - `~` `is_protected`: true -> false

#### postgres_catalogs (1)
- `+` `postgres_catalogs/dev_catalog` — create

#### postgres_endpoints (3)
- `+` `postgres_endpoints/dev_endpoint` — create
- `+` `postgres_endpoints/external_reader_endpoint` — create
- `=` `postgres_endpoints/prd_endpoint`

#### postgres_projects (1)
- `~` `postgres_projects/dagshund_project` — update
  - `+` `custom_tags`: [{key: "env", value: "prd"}]
  - `+` `permissions.[group_name='data_analysts']`: {level: "CAN_USE", group_name: "data_analysts"}

**+5** create, **=1** unchanged, **~2** update
