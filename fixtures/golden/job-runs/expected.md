### dagshund plan (v2, cli 1.7.0)

#### job_runs (1)
- `+` `job_runs/ping_healthcheck` — create

#### jobs (5)
- `=` `jobs/cache_warmup`
  - `+` run `warm_eu_cache` (runs on deploy)
  - `=` run [`warm_us_cache`](https://dbc-c1c0b013-636f.cloud.databricks.com/?o=7474654640708173#job/859083714790909/run/119135840650016) (already ran)
- `=` `jobs/nightly_report`
  - `=` run [`seed_report`](https://dbc-c1c0b013-636f.cloud.databricks.com/?o=7474654640708173#job/358297749448342/run/160668634253625) (already ran)
- `=` `jobs/schema_migration`
  - `~` run [`apply_migrations`](https://dbc-c1c0b013-636f.cloud.databricks.com/?o=7474654640708173#job/39890217972931/run/1114600517425159) (re-runs on deploy)
    - `~` `job_parameters['migration_version']`: "v1" -> "v2"
- `=` `jobs/seed_lookup_tables`
  - `+` run `initial_seed` (runs on deploy)
- `=` `jobs/smoke_check`
  - `-` run [`one_off_audit`](https://dbc-c1c0b013-636f.cloud.databricks.com/?o=7474654640708173#job/805591898206038/run/648429988786839) (run record will be deleted)

**+1** create, **=5** unchanged

runs: **+2** create, **-1** delete, **~1** recreate, **=2** unchanged
