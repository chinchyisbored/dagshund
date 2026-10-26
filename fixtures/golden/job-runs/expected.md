### dagshund plan (v2, cli 1.20.0)

#### job\_runs (1)
- `+` `job_runs/ping_healthcheck` — runs on deploy

#### jobs (5)
- `=` `jobs/cache_warmup`
  - `+` run `warm_eu_cache` (runs on deploy)
  - `=` run [`warm_us_cache`](https://dbc-c1c0b013-636f.cloud.databricks.com/jobs/489820291968/runs/570702113551704?o=7474654640708173) (already ran successfully)
- `=` `jobs/nightly_report`
  - `=` run [`seed_report`](https://dbc-c1c0b013-636f.cloud.databricks.com/jobs/1076643949966399/runs/80753515133717?o=7474654640708173) (already ran successfully)
- `=` `jobs/schema_migration`
  - `~` run [`apply_migrations`](https://dbc-c1c0b013-636f.cloud.databricks.com/jobs/664980881252390/runs/127855859126886?o=7474654640708173) (re-runs on deploy)
    - `~` `job_parameters['migration_version']`: "v1" -&gt; "v2"
- `=` `jobs/seed_lookup_tables`
  - `+` run `initial_seed` (runs on deploy)
- `=` `jobs/smoke_check`
  - `-` run `one_off_audit` (bundle run entry will be removed)

**+1** create, **=5** unchanged

runs: **+2** create, **-1** delete, **~1** recreate, **=2** unchanged
