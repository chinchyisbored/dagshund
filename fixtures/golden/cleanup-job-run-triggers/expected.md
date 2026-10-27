### dagshund plan (v2, cli 1.20.0)

#### jobs (1)
- `=` `jobs/trigger_job`
  - `~` run [`every_deploy`](https://dbc-c1c0b013-636f.cloud.databricks.com/jobs/971607388943390/runs/803377418880214?o=7474654640708173) (runs on every deploy)
  - `~` run [`file_change`](https://dbc-c1c0b013-636f.cloud.databricks.com/jobs/971607388943390/runs/1041732527553192?o=7474654640708173) (re-runs on deploy \(file-change trigger\))
    - watched pattern watched.txt: changed
  - `~` run `one_off` (run entry removed from bundle state; run history preserved)

#### schemas (1)
- `~` `schemas/cleanup_schema` — state cleanup
  - already absent; removing stale bundle state

**~1** state cleanup, **=1** unchanged

runs: **~2** recreate, **~1** state cleanup
