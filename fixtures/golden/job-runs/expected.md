### dagshund plan (v2, cli 1.14.0)

#### job_runs (1)
- `+` `job_runs/ping_healthcheck` — create

#### jobs (5)
- `=` `jobs/cache_warmup`
  - `+` run `warm_eu_cache` (runs on deploy)
  - `=` run [`warm_us_cache`](https://dbc-c1c0b013-636f.cloud.databricks.com/jobs/428524523425937/runs/1051306693093236?o=7474654640708173) (already ran)
- `=` `jobs/nightly_report`
  - `=` run [`seed_report`](https://dbc-c1c0b013-636f.cloud.databricks.com/jobs/895867617366646/runs/680077031090160?o=7474654640708173) (already ran)
- `=` `jobs/schema_migration`
  - `~` run [`apply_migrations`](https://dbc-c1c0b013-636f.cloud.databricks.com/jobs/800870044780677/runs/37190725007976?o=7474654640708173) (re-runs on deploy)
    - `~` `job_parameters['migration_version']`: "v1" -> "v2"
- `=` `jobs/seed_lookup_tables`
  - `+` run `initial_seed` (runs on deploy)
- `=` `jobs/smoke_check`
  - `-` run [`one_off_audit`](https://dbc-c1c0b013-636f.cloud.databricks.com/jobs/204800937493835/runs/1120894676773668?o=7474654640708173) (run record will be deleted)

**+1** create, **=5** unchanged

runs: **+2** create, **-1** delete, **~1** recreate, **=2** unchanged
