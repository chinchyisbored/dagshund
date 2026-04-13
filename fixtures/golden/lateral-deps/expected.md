### dagshund plan (v2, cli 0.296.0)

#### alerts (1)
- `=` `alerts/data_freshness`

#### apps (1)
- `~` `apps/data_app` — update
  - `=` `resources[0].uc_securable.securable_kind`: "TABLE_DB_STORAGE" (remote)

#### dashboards (1)
- `=` `dashboards/metrics`

#### jobs (1)
- `=` `jobs/orchestrator`

#### model_serving_endpoints (1)
- `=` `model_serving_endpoints/phantom_endpoint`

#### pipelines (1)
- `=` `pipelines/etl_pipeline`

#### quality_monitors (1)
- `~` `quality_monitors/table_monitor` — update
  - `=` `schedule.pause_status`: "UNPAUSED" (remote)

#### registered_models (1)
- `=` `registered_models/bundled_model`

**=6** unchanged, **~2** update
