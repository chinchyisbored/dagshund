### dagshund plan (v2, cli 0.296.0)

#### apps (1)
- `~` `apps/my_test_app` — update
  - `~` `resources`: [{job: {id: "824144895872197", permission: "CAN_MANAGE_RUN"}, name: "etl_job"}, {name: "warehouse", sql_warehouse: {id: "9d0afa601cb95187", permission: "CAN_USE"}}, {name: "volume_data", uc_securable: {permission: "READ_VOLUME", securable_full_name: "dagshund.models.a_volume", securable_type: "VOLUME"}}] -> [{job: {id: "824144895872197", permission: "CAN_MANAGE_RUN"}, name: "etl_job"}, {name: "warehouse", sql_warehouse: {id: "9d0afa601cb95187", permission: "CAN_USE"}}, {name: "volume_data", uc_securable: {permission: "READ_VOLUME", securable_full_name: "dagshund.models.a_volume", securable_type: "VOLUME"}}, {experiment: {experiment_id: "3512302282446799", permission: "CAN_READ"}, name: "experiment_tracker"}, {name: "api_token", secret: {key: "external_api_token", permission: "READ", scope: "app_secrets"}}, {name: "chat_model", serving_endpoint: {name: "app_chat_endpoint", permission: "CAN_QUERY"}}]

#### experiments (1)
- `=` `experiments/my_experiment`

#### jobs (1)
- `=` `jobs/my_etl_job`

#### model_serving_endpoints (1)
- `+` `model_serving_endpoints/app_chat_endpoint` — create

**+1** create, **=2** unchanged, **~1** update
