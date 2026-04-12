### dagshund plan (v2, cli 0.296.0)

#### jobs (2)
- `=` `jobs/job_noop`
- `~` `jobs/job_perm_change` — update
  - `+` `permissions.[group_name='data_engineers']`: {level: "CAN_VIEW", group_name: "data_engineers"}
  - `-` `permissions.[group_name='data_readers']`: {level: "CAN_VIEW", group_name: "data_readers"}
  - `~` `permissions.[group_name='viewers'].level`: "CAN_VIEW" -> "CAN_MANAGE_RUN"
  - `+` `run_as`: {user_name: "user2@example.com"}

#### schemas (2)
- `=` `schemas/schema_noop`
- `~` `schemas/schema_perm_change` — update
  - `-` `grants.[principal='data_analysts']`: {principal: "data_analysts", privileges: ["USE_SCHEMA"]}
  - `~` `grants.[principal='data_engineers'].privileges`: ["CREATE_TABLE", "USE_SCHEMA"] -> ["CREATE_TABLE", "MODIFY", "USE_SCHEMA"]
  - `+` `grants.[principal='viewers']`: {principal: "viewers", privileges: ["SELECT", "USE_SCHEMA"]}

**=2** unchanged, **~2** update
