### dagshund plan (v2, cli 1.6.0)

#### jobs (1)
- `~` `jobs/wheel_pipeline` — update
  - `+` `tasks[task_key='aggregate'].depends_on[task_key='validate_orders']`: {task_key: "validate_orders"}
  - `~` `tasks[task_key='aggregate'].libraries`: [1 items] -> [2 items]
  - `+` `tasks[task_key='archive']`: {5 fields}
  - `-` `tasks[task_key='bootstrap']`: {3 fields}
  - `+` `tasks[task_key='deduplicate']`: {4 fields}
  - `+` `tasks[task_key='enrich'].depends_on[task_key='deduplicate']`: {task_key: "deduplicate"}
  - `-` `tasks[task_key='enrich'].depends_on[task_key='merge_datasets']`: {task_key: "merge_datasets"}
  - `-` `tasks[task_key='ingest_customers'].depends_on`: [{task_key: "bootstrap"}]
  - `-` `tasks[task_key='ingest_orders'].depends_on`: [{task_key: "bootstrap"}]
  - `~` `tasks[task_key='validate_orders'].timeout_seconds`: 1800 -> 2400
  - `~` wheel etl_lib updated: 0.1.0 -> 0.2.0 (14 tasks, 2 environments)
  - `~` wheel scoring_lib updated: 1.0.0 -> 1.1.0 (1 task, 1 environment)

**~1** update
