### dagshund plan (v2, cli 1.20.0)

#### jobs (1)
- `~` `jobs/drift_pipeline` — update
  - :warning: manually edited outside bundle
  - `~` `edit_mode`: "EDITABLE" -&gt; "UI\_LOCKED" \(drift\)
  - `=` `email_notifications`: \{no\_alert\_for\_skipped\_runs: false\} \(remote\)
  - `=` `performance_target`: "PERFORMANCE\_OPTIMIZED" \(remote\)
  - `-` `tasks[task_key='publish'].depends_on[task_key='ingest']`: \{task\_key: "ingest"\} \(drift\)
  - `+` `tasks[task_key='publish'].depends_on[task_key='transform']` (drift) (re-added)
  - `+` `tasks[task_key='transform']` (drift) (re-added)

#### schemas (2)
- `+` `schemas/drift_doomed` — create
- `~` `schemas/drift_grants` — update
  - :warning: manually edited outside bundle
  - `-` `grants.[principal='account users']`: \{principal: "account users", privileges: \["SELECT", "USE\_SCHEMA"\]\} \(drift\)
  - `~` `grants.[principal='data_readers'].privileges`: \["USE\_SCHEMA"\] -&gt; \["SELECT", "USE\_SCHEMA"\] \(drift\)
  - `+` `grants.[principal='data_engineers']` (drift) (re-added)

**+1** create, **~2** update

> [!WARNING]
> **Manual Edits Detected**
> - jobs/drift\_pipeline was edited outside the bundle
>   - 2 fields will be overwritten
>   - 1 depends\_on will be re-added \(transform\)
>   - 1 task will be re-added \(transform\)
> - schemas/drift\_grants was edited outside the bundle
>   - 2 fields will be overwritten
>   - 1 grant will be re-added \(data\_engineers\)
