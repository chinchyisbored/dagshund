### dagshund plan (v2, cli 1.20.0)

#### alerts (1)
- `~` `alerts/stale_pipeline_alert` — update
  - `~` `evaluation.threshold.value.double_value`: 0 -&gt; 100

#### experiments (2)
- `=` `experiments/audit_analysis`
- `+` `experiments/audit_analysis_final` — create

#### jobs (2)
- `~` `jobs/data_quality_pipeline` — update
  - `+` `tasks[task_key='aggregate_results'].depends_on[task_key='check_duplicates']`: \{task\_key: "check\_duplicates"\}
  - `+` `tasks[task_key='aggregate_results'].depends_on[task_key='check_referential_integrity']`: \{task\_key: "check\_referential\_integrity"\}
  - `+` `tasks[task_key='anomaly_detection']`: \{3 fields\}
  - `+` `tasks[task_key='check_duplicates']`: \{3 fields\}
  - `+` `tasks[task_key='check_referential_integrity']`: \{3 fields\}
  - `+` `tasks[task_key='compute_statistics'].depends_on[task_key='check_duplicates']`: \{task\_key: "check\_duplicates"\}
  - `+` `tasks[task_key='generate_report'].depends_on[task_key='anomaly_detection']`: \{task\_key: "anomaly\_detection"\}
  - `-` `tasks[task_key='notify_stakeholders']`: \{3 fields\}
  - `~` `tasks[task_key='validate_schema'].notebook_task.base_parameters['sample_size']`: "1000" -&gt; "10000"
  - `~` `tasks[task_key='validate_schema'].notebook_task.base_parameters['strict_mode']`: "false" -&gt; "true"
- `~` `jobs/etl_pipeline` — update
  - `+` `tasks[task_key='aggregate']`: \{3 fields\}
  - `~` `tasks[task_key='transform'].notebook_task.notebook_path`: "/Workspace/etl/transform" -&gt; "/Workspace/etl/transform\_v2"
  - `+` `tasks[task_key='trigger_quality_check']`: \{3 fields\}
  - `-` `tasks[task_key='validate']`: \{3 fields\}

#### schemas (2)
- `=` `schemas/analytics`
- `+` `schemas/analytics_staging` — create

#### volumes (2)
- `-` `volumes/old_exports` — delete
- `=` `volumes/raw_data`

**+2** create, **-1** delete, **=3** unchanged, **~3** update

> [!CAUTION]
> **Dangerous Actions**
> - volumes/old\_exports will be deleted — all files in this volume will be lost
