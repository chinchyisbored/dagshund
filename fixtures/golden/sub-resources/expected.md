### dagshund plan (v2, cli 1.20.0)

#### jobs (2)
- `=` `jobs/job_noop`
- `~` `jobs/job_perm_change` — update
  - `+` `permissions.[group_name='data_engineers']`: \{level: "CAN\_VIEW", group\_name: "data\_engineers"\}
  - `-` `permissions.[group_name='data_readers']`: \{level: "CAN\_VIEW", group\_name: "data\_readers"\}
  - `~` `permissions.[group_name='viewers'].level`: "CAN\_VIEW" -&gt; "CAN\_MANAGE\_RUN"
  - `+` `run_as`: \{user\_name: "user2@example.com"\}

#### schemas (2)
- `=` `schemas/schema_noop`
- `~` `schemas/schema_perm_change` — update
  - `-` `grants.[principal='data_analysts']`: \{principal: "data\_analysts", privileges: \["USE\_SCHEMA"\]\}
  - `~` `grants.[principal='data_engineers'].privileges`: \["CREATE\_TABLE", "USE\_SCHEMA"\] -&gt; \["CREATE\_TABLE", "MODIFY", "USE\_SCHEMA"\]
  - `+` `grants.[principal='viewers']`: \{principal: "viewers", privileges: \["SELECT", "USE\_SCHEMA"\]\}

**=2** unchanged, **~2** update
