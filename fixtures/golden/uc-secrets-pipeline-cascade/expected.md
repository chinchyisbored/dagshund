### dagshund plan (v2, cli 1.20.0)

#### pipelines (4)
- `-` `pipelines/cascade_on_delete` — delete
- `-` `pipelines/default_on_delete` — delete
- `-` `pipelines/retain_on_delete` — delete
- `~` `pipelines/update_cascade_only` — update
  - `~` `cascade_on_destroy`: false -&gt; true

#### schemas (1)
- `=` `schemas/cli_resources`

#### secrets (5)
- `+` `secrets/created_secret` — create
- `-` `secrets/deleted_secret` — delete
- `~` `secrets/grants_secret` — update
  - `+` `grants.[principal='data_analysts']`: \{principal: "data\_analysts", privileges: \["READ\_SECRET"\]\}
  - `-` `grants.[principal='data_readers']`: \{principal: "data\_readers", privileges: \["READ\_SECRET"\]\}
- `~` `secrets/recreated_secret` — recreate
  - `~` `name`: "recreated\_secret\_before" -&gt; "recreated\_secret\_after"
- `~` `secrets/updated_secret` — update
  - `~` `comment`: "Before update" -&gt; "After update"
  - `~` `value`: "" -&gt; "\[redacted\]" \(secret values unavailable\)

**+1** create, **-4** delete, **~1** recreate, **=1** unchanged, **~3** update

> [!CAUTION]
> **Dangerous Actions**
> - pipelines/cascade\_on\_delete will be deleted — pipeline-managed materialized views, streaming tables, and views may also be deleted because cascade\_on\_destroy is unavailable in this plan
> - pipelines/default\_on\_delete will be deleted — pipeline-managed materialized views, streaming tables, and views may also be deleted because cascade\_on\_destroy is unavailable in this plan
> - pipelines/retain\_on\_delete will be deleted — pipeline-managed materialized views, streaming tables, and views may also be deleted because cascade\_on\_destroy is unavailable in this plan
