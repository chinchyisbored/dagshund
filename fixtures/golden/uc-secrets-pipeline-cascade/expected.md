### dagshund plan (v2, cli 1.14.0)

#### pipelines (4)
- `-` `pipelines/cascade_on_delete` — delete
- `-` `pipelines/default_on_delete` — delete
- `-` `pipelines/retain_on_delete` — delete
- `~` `pipelines/update_cascade_only` — update
  - `~` `cascade_on_destroy`: false -> true

#### schemas (1)
- `=` `schemas/cli_resources`

#### secrets (5)
- `+` `secrets/created_secret` — create
- `-` `secrets/deleted_secret` — delete
- `~` `secrets/grants_secret` — update
  - `+` `grants.[principal='data_analysts']`: {principal: "data_analysts", privileges: ["READ_SECRET"]}
  - `-` `grants.[principal='data_readers']`: {principal: "data_readers", privileges: ["READ_SECRET"]}
- `~` `secrets/recreated_secret` — recreate
  - `~` `name`: "recreated_secret_before" -> "recreated_secret_after"
- `~` `secrets/updated_secret` — update
  - `~` `comment`: "Before update" -> "After update"
  - `~` `value`: "" -> "[redacted]"

**+1** create, **-4** delete, **~1** recreate, **=1** unchanged, **~3** update

> [!CAUTION]
> **Dangerous Actions**
> - pipelines/cascade_on_delete will be deleted — pipeline-managed materialized views, streaming tables, and views may also be deleted because cascade_on_destroy is unavailable in this plan
> - pipelines/default_on_delete will be deleted — pipeline-managed materialized views, streaming tables, and views may also be deleted because cascade_on_destroy is unavailable in this plan
> - pipelines/retain_on_delete will be deleted — pipeline-managed materialized views, streaming tables, and views may also be deleted because cascade_on_destroy is unavailable in this plan
