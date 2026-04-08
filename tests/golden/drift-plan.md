### dagshund plan (v2, cli 0.294.0)

#### jobs (1)
- `~` `jobs/drift_pipeline` — update
  - :warning: manually edited outside bundle
  - `~` `edit_mode`: "EDITABLE" -> "UI_LOCKED" (drift)
  - `~` `email_notifications`: {1 fields} (remote)
  - `~` `performance_target`: "PERFORMANCE_OPTIMIZED" (remote)
  - `~` `tasks[task_key='publish'].depends_on[0].task_key`: "ingest" -> "transform" (drift)

**~1** update

> [!WARNING]
> **Manual Edits Detected**
> - jobs/drift_pipeline was edited outside the bundle (2 fields will be overwritten)
