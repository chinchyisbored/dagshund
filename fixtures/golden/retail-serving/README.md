# Independent Delta-to-Lakebase retail serving

This fixture describes an independently owned Lakebase project that serves three existing Delta source tables through PostgreSQL synced tables. The before state has customer and product lookups; the after state adds inventory. The sources remain outside the bundle and outside fixture teardown.

## Configuration and ownership

Both states use the same direct-engine bundle, CLI 1.20.0, workspace, caller-specific bundle root, `retail-serving` project, `production` branch, and implicit primary endpoint. The fixture is intended for a fresh project with absent fixture-owned names; `replace_existing` is limited to the owned production branch and primary endpoint. It does not adopt existing resources.

The bundle configures the logical Lakebase role `serving_reader` as the physical PostgreSQL role `data_analysts`, with `identity_type: GROUP`. This role owns only the fresh `retail_lookup` database. In the after state, the project grants the `data_analysts` group `CAN_USE`. This is project access, not a read-only authorization claim: the physical group role has no declared attributes here, and PostgreSQL role/default privileges and the effective permissions of the group must be assessed from the actual backend state.

Both states refer to source names through the optional `customer_snapshot_full_name` and `product_snapshot_full_name` variables from `../../externals.yaml`; after also uses `inventory_delta_full_name`. Their defaults name the independently provisioned empty tables in `dagshund.retail_sources`. The fixture does not declare, create, query, populate, own, or delete the source schema or source tables. See [`../../EXTERNALS.md`](../../EXTERNALS.md) for source contracts and provenance limits.

Each synced-table destination is a standard Unity Catalog catalog target under `dagshund.retail_sync`, with the Lakebase database and managed branch specified explicitly. The pipeline storage catalog/schema also points to `dagshund.retail_sync`; this is sync storage, not a declaration that the source tables live there. The fixture-owned Unity Catalog outputs include the `dagshund.retail_sync` schema and the fixture's intended managed Lakebase outputs are its project, production branch, primary endpoint, `serving_reader` role, `retail_lookup` database, and the two or three configured synced tables. Teardown removes the owned schema only after its dependent sync and pipeline outputs. The backend may create pipeline and derived Unity Catalog storage outputs as part of sync initialization. Their exact IDs, ownership, retention, and cleanup behavior are not yet established by this configuration and must be recorded from an actual lifecycle before treating this inventory as complete.

## Capacity and state difference

Endpoint autoscaling remains at a minimum of 0.5 CU. Its maximum changes from 0.5 CU before to 1 CU after. The after state adds `inventory_lookup` from the independently supplied inventory source and grants the project `CAN_USE` to `data_analysts`. The customer and product sync definitions otherwise remain the same.

`CONTINUOUS` is configured for each sync. The approved workflow permits normal initial sync/index initialization against the empty sources; this YAML alone does not prove backend acceptance, key/CDF handling, derived outputs, or successful cleanup. No manual sync, SQL, business data, source query, or population step is part of the fixture story.

## Genuine capture and observed limits

The unchanged generator completed the original normal cycle (attempt 1223): eight baseline resources were created; the after plan was captured before the after deploy; the after deploy created two resources, changed one endpoint, and left seven unchanged; teardown ran for nine resources. The captured plan is a sanitized CLI 1.20.0 plan from the same bundle root, workspace, and caller-specific bundle setup. Its SHA-256 is `d0e5310fe7361121c6ab89c943ccb7d562bf03b0d57f47fd21f882a799c52465`.

The two captured baseline synced tables reported Unity Catalog provisioning `ACTIVE` while their detailed state was `SYNCED_TABLE_PROVISIONING_PIPELINE_RESOURCES`. This proves neither completed initialization nor data replication/readiness. The lifecycle did not run manual SQL, queries, manual syncs, or business-data work. Inventory's after-only pipeline ID was not present in the pre-after-deploy plan and is not fabricated here.

Post-teardown checks found the fixture root, project, owned storage schema, all three synced-table APIs and UC registrations absent; both captured pipeline IDs absent; and no matching project namespace in the full pipeline list. No extra deletes were used. This establishes the observed API and namespace cleanup checks, not physical/history purge. All three external source tables retained their same IDs and CDF settings. Sources and their schema remain external and must not be removed by fixture teardown.
