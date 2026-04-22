### dagshund plan (v2, cli 0.298.0)

#### alerts (1)
- `=` `alerts/data_freshness`

#### dashboards (1)
- `=` `dashboards/metrics`

#### jobs (3)
- `=` `jobs/orchestrator`
- `=` `jobs/worker_a`
- `=` `jobs/worker_b`

#### model_serving_endpoints (1)
- `=` `model_serving_endpoints/phantom_endpoint`

#### pipelines (1)
- `=` `pipelines/etl_pipeline`

#### quality_monitors (1)
- `~` `quality_monitors/table_monitor` — update
  - `=` `schedule.pause_status`: "UNPAUSED" (remote)

**=7** unchanged, **~1** update
