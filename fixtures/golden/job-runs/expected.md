### dagshund plan (v2, cli 1.10.0)

#### job_runs (1)
- `+` `job_runs/ping_healthcheck` — create

#### jobs (5)
- `=` `jobs/cache_warmup`
  - `+` run `warm_eu_cache` (runs on deploy)
  - `=` run [`warm_us_cache`](https://dbc-c1c0b013-636f.cloud.databricks.com/?o=7474654640708173#job/642579520123604/run/440905141337111) (already ran)
- `=` `jobs/nightly_report`
  - `=` run [`seed_report`](https://dbc-c1c0b013-636f.cloud.databricks.com/?o=7474654640708173#job/828445533162707/run/662476000693781) (already ran)
- `=` `jobs/schema_migration`
  - `~` run [`apply_migrations`](https://dbc-c1c0b013-636f.cloud.databricks.com/?o=7474654640708173#job/1055377491175506/run/68045634068767) (re-runs on deploy)
    - `~` `job_parameters['migration_version']`: "v1" -> "v2"
- `=` `jobs/seed_lookup_tables`
  - `+` run `initial_seed` (runs on deploy)
- `=` `jobs/smoke_check`
  - `-` run [`one_off_audit`](https://dbc-c1c0b013-636f.cloud.databricks.com/?o=7474654640708173#job/708871805319302/run/596973884122537) (run record will be deleted)

**+1** create, **=5** unchanged

runs: **+2** create, **-1** delete, **~1** recreate, **=2** unchanged
