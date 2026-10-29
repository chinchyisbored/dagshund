### dagshund plan (v2, cli 1.20.0)

#### postgres\_branches (1)
- `=` `postgres_branches/production`

#### postgres\_databases (1)
- `=` `postgres_databases/retail_lookup`

#### postgres\_endpoints (1)
- `~` `postgres_endpoints/primary` — update
  - `~` `autoscaling_limit_max_cu`: 0.5 -&gt; 1

#### postgres\_projects (1)
- `~` `postgres_projects/retail_serving` — update
  - `+` `permissions`: \{2 fields\}

#### postgres\_roles (1)
- `=` `postgres_roles/serving_reader`

#### postgres\_synced\_tables (3)
- `=` `postgres_synced_tables/customer_lookup`
  - `=` managed pipeline: `customer_lookup pipeline`
  - `=` managed Unity Catalog registration: `dagshund.retail_sync.customer_lookup`
- `+` `postgres_synced_tables/inventory_lookup` — create
  - `+` managed pipeline: `inventory_lookup pipeline`
  - `+` managed Unity Catalog registration: `dagshund.retail_sync.inventory_lookup`
- `=` `postgres_synced_tables/product_lookup`
  - `=` managed pipeline: `product_lookup pipeline`
  - `=` managed Unity Catalog registration: `dagshund.retail_sync.product_lookup`

#### schemas (1)
- `=` `schemas/retail_sync`

**+1** create, **=6** unchanged, **~2** update
