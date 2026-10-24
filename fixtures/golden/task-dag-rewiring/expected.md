### dagshund plan (v2, cli 1.14.0)

#### jobs (2)
- `~` `jobs/data_pipeline` — update
  - `+` `tasks[task_key='audit']`: \{2 fields\}
  - `+` `tasks[task_key='clean'].depends_on[task_key='ingest']`: \{task\_key: "ingest"\}
  - `-` `tasks[task_key='clean'].depends_on[task_key='normalize']`: \{task\_key: "normalize"\}
  - `+` `tasks[task_key='clean_v2']`: \{3 fields\}
  - `+` `tasks[task_key='enrich'].depends_on[task_key='clean']`: \{task\_key: "clean"\}
  - `+` `tasks[task_key='filter'].depends_on[task_key='ingest']`: \{task\_key: "ingest"\}
  - `-` `tasks[task_key='filter'].depends_on[task_key='standby']`: \{task\_key: "standby"\}
  - `+` `tasks[task_key='monitor'].depends_on`: \[\{task\_key: "ingest"\}\]
  - `-` `tasks[task_key='normalize'].depends_on`: \[\{task\_key: "ingest"\}\]
  - `-` `tasks[task_key='process_a'].depends_on[task_key='filter']`: \{task\_key: "filter"\}
  - `+` `tasks[task_key='process_a'].depends_on[task_key='validate']`: \{task\_key: "validate"\}
  - `-` `tasks[task_key='process_b'].depends_on[task_key='clean']`: \{task\_key: "clean"\}
  - `-` `tasks[task_key='process_b'].depends_on[task_key='filter']`: \{task\_key: "filter"\}
  - `+` `tasks[task_key='process_b'].depends_on[task_key='ingest']`: \{task\_key: "ingest"\}
  - `+` `tasks[task_key='process_b'].depends_on[task_key='validate']`: \{task\_key: "validate"\}
  - `-` `tasks[task_key='standby']`: \{2 fields\}
  - `-` `tasks[task_key='validate'].depends_on[task_key='clean']`: \{task\_key: "clean"\}
  - `+` `tasks[task_key='validate'].depends_on[task_key='clean_v2']`: \{task\_key: "clean\_v2"\}
- `~` `jobs/etl_pipeline` — update
  - `-` `tasks[task_key='check_row_count']`: \{3 fields\}
  - `-` `tasks[task_key='full_validation'].depends_on[task_key='check_row_count']`: \{task\_key: "check\_row\_count"\}
  - `+` `tasks[task_key='full_validation'].depends_on[task_key='load']`: \{task\_key: "load"\}
  - `-` `tasks[task_key='publish'].depends_on[task_key='skip_validation']`: \{task\_key: "skip\_validation"\}
  - `-` `tasks[task_key='skip_validation']`: \{3 fields\}

**~2** update
