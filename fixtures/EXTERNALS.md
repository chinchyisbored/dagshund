# External fixture prerequisites

Golden fixtures can refer to workspace resources that they do not own. Create and verify those resources separately from fixture deployment. Fixture teardown must not delete them.

## Empty retail source tables

The retail sync fixture (task `.9`) depends on three independently owned, empty managed Delta source tables in `dagshund.retail_sources`. The closed `retail-de` fixture does not use these tables. The schema and all three tables were created and their metadata verified in the approved provisioning cycle on 2026-10-29; metadata is a point-in-time record, so recheck names and metadata before use. The actual owner matched the provisioning caller. These resources were created independently of fixture deployment and persist through every fixture cleanup.

| Table | Columns | Sync key |
| --- | --- | --- |
| `customer_snapshot` | `customer_id STRING NOT NULL`, `customer_name STRING`, `loyalty_tier STRING` | `customer_id` |
| `product_snapshot` | `product_id STRING NOT NULL`, `product_name STRING`, `category STRING` | `product_id` |
| `inventory_delta` | `store_id STRING NOT NULL`, `product_id STRING NOT NULL`, `quantity_available INT`, `updated_at TIMESTAMP` | `store_id`, `product_id` |

All three must be managed Delta tables with Change Data Feed enabled. No rows are required or approved. The caller who creates each object owns it; the catalog is the pre-existing `dagshund` catalog. Provisioning is independent of bundle deployment and persists through every fixture cleanup.

### Before creating anything

1. Confirm the effective Databricks CLI host and profile match the approved DEFAULT workspace `https://dbc-c1c0b013-636f.cloud.databricks.com`. Check the active workspace and caller (for example, with `databricks auth describe`). Stop before any schema or table write if the host or profile does not resolve to that workspace. Do not put a principal name in fixture variables or this guide.
2. Confirm the caller owns the catalog or has the required schema-creation and table-creation privileges.
3. Inspect `dagshund.retail_sources` and all three full table names. If the schema or any table exists, stop and establish its owner, provenance, columns, managed status, keys and CDF metadata. Do not adopt or overwrite existing resources.
4. Confirm no unrelated actor is creating these names. Immediately before the first schema write, freshly verify that existing warehouse `9d0afa601cb95187` is in the approved workspace and that the caller can access it (for example, inspect it with `databricks warehouses get 9d0afa601cb95187`). Stop if its identity or access cannot be confirmed. SQL DDL can start it and consume workspace quota. Do not create, replace or stop a warehouse.

The Databricks CLI 1.20 command to create the schema is:

```sh
databricks schemas create retail_sources dagshund
```

For each absent table, submit only its `CREATE TABLE` statement through the public SQL Statements API. For example, write a request file containing the following JSON, with the appropriate statement substituted for each table:

```json
{
  "warehouse_id": "9d0afa601cb95187",
  "statement": "CREATE TABLE dagshund.retail_sources.customer_snapshot (customer_id STRING NOT NULL, customer_name STRING, loyalty_tier STRING, CONSTRAINT customer_snapshot_pk PRIMARY KEY (customer_id)) USING DELTA TBLPROPERTIES ('delta.enableChangeDataFeed' = 'true')",
  "wait_timeout": "50s",
  "on_wait_timeout": "CONTINUE"
}
```

Submit it with:

```sh
databricks api post /api/2.0/sql/statements --json @request.json
```

Use the analogous statement for `product_snapshot` with `CONSTRAINT product_snapshot_pk PRIMARY KEY (product_id)`, and `inventory_delta` with `CONSTRAINT inventory_delta_pk PRIMARY KEY (store_id, product_id)`, matching the table inventory above. These Unity Catalog primary-key constraints document the sync keys; they do not enforce uniqueness. CLI 1.20 has no `statement-execution` command group. Do not use `IF NOT EXISTS`, `OR REPLACE`, `AS SELECT`, inserts, or other SQL. Do not add unrelated properties or constraints.

The API may return a statement ID before execution finishes. Check the returned status; when it is pending, poll with:

```sh
databricks api get /api/2.0/sql/statements/<statement-id>
```

If a request times out, the connection drops, or the result is otherwise uncertain, inspect the statement status and resource metadata before considering a retry. Never blindly resubmit a create request.

### Verify and record

For each table, metadata was verified with:

```sh
databricks schemas get dagshund.retail_sources
databricks tables get dagshund.retail_sources.customer_snapshot --include-delta-metadata
```

Repeat the table command for the other two tables. The verified metadata matched the actual owner, catalog/schema/name, managed table type, exact column names/types/nullability, Delta format, CDF enabled, and approved primary-key contracts shown above. Creation used `CREATE` without `AS SELECT` or `INSERT`; no rows were written. The primary-key constraints document sync keys and do not enforce uniqueness. The timestamped provisioning-cycle record documents the schema and each table's verified metadata. This records metadata at verification time only; recheck before use. No data query or empty-source sync/index acceptance is asserted here.

These tables are external prerequisites, not fixture-owned resources. Never include them in bundle resources or teardown. Native empty-source sync/index initialization may be exercised by its named consumer cycle; empty metadata alone does not prove that initialization, key handling, CDF, permissions, or backend acceptance works. The retail source consumer is the retail sync fixture (task `.9`); the conditional AI Search consumer is task `.12` only if that route is actually selected.

## Other external resources

`fixtures/golden/externals.yaml` holds shared, descriptive defaults for external fixture references. Retail full table names can be overridden using the corresponding `BUNDLE_VAR_customer_snapshot_full_name`, `BUNDLE_VAR_product_snapshot_full_name`, and `BUNDLE_VAR_inventory_delta_full_name` variables. These defaults do not create or validate resources, and no new setup is required for existing fixtures.

### Agent App knowledge source

The Agent App RAG showcase uses the independently owned, empty managed Delta table
`dagshund.retail_sources.knowledge_source`. Its observed metadata is `document_id STRING NOT NULL`
and `content STRING`, with Change Data Feed enabled and an informational primary-key constraint
on `document_id`. It was created independently of the fixture using the approved CREATE-only
request below, with no rows. The table and `retail_sources` schema are not bundle resources: never
adopt, populate, query, sync directly, or delete them as part of fixture deployment or teardown.
The schema already exists; unlike a fresh setup, do not run a schema-creation command for it. This
runbook records the approved operation, not authorization to provision it again. Recheck owner and
metadata before use; this is not a live readiness check.

#### Approved source-table operation

The approved operation created only the table in the already-owned schema. Before any separately
authorized create operation, use the same safeguards as the retail tables above:

1. Confirm the effective Databricks CLI host and profile resolve to the approved DEFAULT workspace
   `https://dbc-c1c0b013-636f.cloud.databricks.com` (for example, `databricks auth describe`). Stop
   if they do not match. Do not record a principal name here.
2. Confirm the caller owns the existing schema or has the required table-creation privileges.
3. Inspect `dagshund.retail_sources` and the full table name. If the table exists, stop and verify
   its owner, provenance, columns, managed status, key, and CDF metadata. Do not adopt or overwrite
   an existing object; confirm no unrelated actor is creating the name.
4. Confirm the existing warehouse `9d0afa601cb95187` belongs to the approved workspace and that
   the caller can access it (for example, `databricks warehouses get 9d0afa601cb95187`). SQL DDL
   can start it and consume workspace quota. Do not create, replace, or stop a warehouse.

The approved SQL Statements API request was:

```json
{
  "warehouse_id": "9d0afa601cb95187",
  "statement": "CREATE TABLE dagshund.retail_sources.knowledge_source (document_id STRING NOT NULL, content STRING, CONSTRAINT knowledge_source_pk PRIMARY KEY (document_id)) USING DELTA TBLPROPERTIES ('delta.enableChangeDataFeed' = 'true')",
  "wait_timeout": "50s",
  "on_wait_timeout": "CONTINUE"
}
```

Submit a request file with the public CLI command:

```sh
databricks api post /api/2.0/sql/statements --json @request.json
```

If the API returns before execution finishes, inspect the returned status and poll pending
statements with `databricks api get /api/2.0/sql/statements/<statement-id>`. If the request times
out, the connection drops, or its result is uncertain, inspect statement status and resource
metadata before considering a retry. Never blindly resubmit. Do not add `IF NOT EXISTS`,
`OR REPLACE`, `AS SELECT`, inserts, or other SQL or properties. The primary-key constraint records
the key; it does not enforce uniqueness. CREATE alone produces no source rows and is not a data
verification claim.

Verify schema and table metadata with:

```sh
databricks schemas get dagshund.retail_sources
databricks tables get dagshund.retail_sources.knowledge_source --include-delta-metadata
```

Check the owner, catalog/schema/name, managed table type, exact columns and nullability, Delta
format, CDF enabled, and the primary-key contract against the observed metadata above. This
metadata inspection does not query rows or establish search readiness. Existing metadata and
provisioning receipts are point-in-time evidence; recheck before use.

The fixture's managed vector index references that table and the existing
`databricks-gte-large-en` embedding endpoint using the same endpoint for default query embedding.
The full table name and embedding endpoint are descriptive defaults in `externals.yaml`, overridable
with `BUNDLE_VAR_agent_knowledge_source_full_name` and
`BUNDLE_VAR_agent_knowledge_embedding_endpoint`. They do not create or validate either external
resource. Native index initialization is asynchronous; captured index creation or an available
binding does not prove index readiness, replication, embedding success, or search behavior. No
query or inference is part of the fixture.

The source and embedding metadata were inspected during the approved capability check recorded in
`/home/chinchy/.local/share/dagshund/workflow-evidence/m1oo/2/rag-binding-1192/`. That check's
probe resources were cleaned up and the independent source was preserved. It was a metadata and
App-binding check, not evidence of the fixture's own complete create/cleanup cycle or search
readiness. Fixture capture documentation must state exact owned-resource cleanup evidence, pending
or asynchronous deletion where relevant, and must continue to distinguish unmanaged source
preservation from bundle-owned cleanup.

Other fixture-specific external resources and their ownership/cleanup boundaries are documented beside the fixture that uses them, including [`golden/retail-de/README.md`](golden/retail-de/README.md). The phantom Lakebase references in the `job-runs` fixture are identifiers for graph coverage, not evidence that this guide provisions a Lakebase project or branch. The Agent App fixture has the documented independent knowledge-table and embedding-endpoint prerequisites; their metadata and binding were checked, but index readiness, search behavior, and functional RAG are not established.
