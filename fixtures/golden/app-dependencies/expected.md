### dagshund plan (v2, cli 1.14.0)

#### apps (1)
- `~` `apps/my_test_app` — update
  - `~` `resources`: [3 items] -> [7 items]

#### experiments (1)
- `=` `experiments/my_experiment`

#### genie_spaces (1)
- `~` `genie_spaces/nyc_taxi_genie` — update
  - `~` `permissions.[group_name='users'].level`: "CAN_RUN" -> "CAN_MANAGE"

#### jobs (1)
- `=` `jobs/my_etl_job`

#### model_serving_endpoints (1)
- `+` `model_serving_endpoints/app_chat_endpoint` — create

**+1** create, **=2** unchanged, **~2** update
