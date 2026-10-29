### dagshund plan (v2, cli 1.20.0)

#### experiments (2)
- `=` `experiments/training_experiment`
- `=` `experiments/validation`

#### jobs (2)
- `=` `jobs/seed_model_versions_job`
  - `=` run [`seed_model_versions_run`](https://dbc-c1c0b013-636f.cloud.databricks.com/jobs/800016352435954/runs/683357471103259?o=7474654640708173) (already ran successfully)
- `~` `jobs/workflow` — update
  - `~` `parameters[name='learning_rate'].default`: "0.1" -&gt; "0.05"
  - `+` `tasks[task_key='compare_models']`: \{3 fields\}
  - `+` `tasks[task_key='evaluate_baseline']`: \{3 fields\}
  - `+` `tasks[task_key='quality_gate']`: \{3 fields\}
  - `-` `tasks[task_key='register_promote'].depends_on[task_key='evaluate_candidate']`: \{task\_key: "evaluate\_candidate"\}
  - `+` `tasks[task_key='register_promote'].depends_on[task_key='quality_gate']`: \{outcome: "true", task\_key: "quality\_gate"\}
  - `+` `tasks[task_key='train_baseline']`: \{3 fields\}

#### model\_serving\_endpoints (1)
- `~` `model_serving_endpoints/candidate_endpoint` — update
  - `~` `config.served_entities[0].entity_version`: "1" -&gt; "2"
  - `+` `permissions`: \{2 fields\}

#### registered\_models (2)
- `=` `registered_models/baseline`
- `~` `registered_models/candidate` — update
  - `+` `grants`: \{3 fields\}

#### schemas (2)
- `~` `schemas/registry` — update
  - `+` `grants`: \{3 fields\}
- `=` `schemas/training_schema`

#### volumes (1)
- `=` `volumes/training_data`

**=6** unchanged, **~4** update

runs: **=1** unchanged
