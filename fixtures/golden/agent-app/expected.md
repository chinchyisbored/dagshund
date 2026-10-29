### dagshund plan (v2, cli 1.20.0)

#### apps (1)
- `~` `apps/retail_assistant` — update
  - `~` `resources`: \[3 items\] -&gt; \[5 items\]

#### experiments (1)
- `=` `experiments/retail_agent_traces`

#### jobs (2)
- `=` `jobs/initialize_agent_storage`
  - `~` run [`apply_session_migration`](https://dbc-c1c0b013-636f.cloud.databricks.com/jobs/588366231426072/runs/885521012460117?o=7474654640708173) (re-runs on deploy)
    - `~` `job_parameters['schema_version']`: "v1" -&gt; "v2"
- `=` `jobs/prepare_agent_knowledge`

#### postgres\_branches (1)
- `=` `postgres_branches/production`

#### postgres\_databases (1)
- `=` `postgres_databases/agent_sessions`

#### postgres\_endpoints (1)
- `~` `postgres_endpoints/production_endpoint` — update
  - `~` `autoscaling_limit_max_cu`: 0.5 -&gt; 1

#### postgres\_projects (1)
- `=` `postgres_projects/retail_agent`

#### postgres\_roles (1)
- `=` `postgres_roles/agent_app`

#### schemas (1)
- `=` `schemas/agent_knowledge_schema`

#### vector\_search\_endpoints (1)
- `=` `vector_search_endpoints/agent_knowledge_endpoint`

#### vector\_search\_indexes (1)
- `+` `vector_search_indexes/agent_knowledge_index` — create

#### volumes (1)
- `=` `volumes/agent_knowledge_volume`

**+1** create, **=10** unchanged, **~2** update

runs: **~1** recreate
