# Agent App session storage and migration showcase

The current fixture is the genuine Databricks CLI 1.20.0 capture from the
approved Agent App RAG normal cycle documented below. It preserves actual
workspace resource and run identities while excluding caller and secondary
credential values.

The original session-storage capture is historical evidence from the earlier
`.8` cycle, not the current fixture plan. Its source plan and cleanup receipt
remain at
`/home/chinchy/.local/share/dagshund/workflow-evidence/m1oo/8/agent-app-normal-cycle-1164.json`
and `normal-cycle-verification-1164.json`; the accepted baseline is also
archived at `/home/chinchy/.local/share/dagshund/workflow-evidence/m1oo/12/baseline-430c8f1/`.

The retained plan describes the managed `retail-assistant` App, `retail-agent`
Lakebase Autoscaling project, production branch and primary endpoint, an owned
`agent_sessions` database, a Workspace MLflow experiment, and a three-task
`initialize_agent_storage` job. The App's database resource points to the
captured managed branch/database, and its experiment binding grants `CAN_EDIT`.
The later state adds the existing external serving endpoint
`databricks-gpt-oss-20b` with `CAN_QUERY` and changes maximum capacity from 0.5
CU to 1 CU (minimum remains 0.5 CU).

The current bundle source adds a managed `agent_knowledge` schema, managed
volume, three-task print-only document-preparation job, and STANDARD
vector-search endpoint to both states. The App has a `READ_VOLUME` binding in
both states. The after state adds a managed `DELTA_SYNC`/`TRIGGERED` index on
`dagshund.retail_sources.knowledge_source`, using `document_id` as key,
`content` with `databricks-gte-large-en` embeddings, and an App `TABLE`/`SELECT`
binding to the index's actual managed name. The independent source table is
outside fixture ownership; see [EXTERNALS.md](../../EXTERNALS.md) for its
observed metadata and preservation limits.

The current `plan.json` is the genuine CLI 1.20.0 capture from the approved
named `agent-app` normal cycle. The before deployment created 13 resources; the
after deployment created 2, changed 2, deleted 1, and left 10 unchanged; destroy
reported 13 deleted. See `/home/chinchy/.local/share/dagshund/workflow-evidence/m1oo/12/agent-app-rag-normal-cycle-1225.json`
and `normal-cycle-verification-1225.json` for the plan and independently
verified cleanup evidence. The older accepted capture is preserved at
`/home/chinchy/.local/share/dagshund/workflow-evidence/m1oo/12/baseline-430c8f1/`.

The print-only `initialize_agent_storage` runs succeeded for schema versions
v1 and v2; the document-preparation job was not run. No SQL, query, inference,
embedding call, trace creation, or data processing occurred. Cleanup confirms
that the owned resources and bundle root are absent. The search endpoint lookup
reported a deleting/deleted tombstone, not definitive physical purge, and the
after-only generated pipeline ID was not available in the pre-deploy plan. The
independent source table was preserved. Index initialization is asynchronous;
this capture does not establish readiness, replication, search behavior,
embedding success, or functional RAG.

The fixture uses the existing `data_analysts` group as the OAuth-backed owner
of the newly created, empty fixture database. Its logical bundle key is
`agent_app`, but the accepted managed role ID and physical Postgres role name
are `data-analysts` and `data_analysts`. This is group ownership of this fixture
database only, not external databases. The database's captured role reference
resolves to `projects/retail-agent/branches/production/roles/data-analysts`.

The three print-only tasks (`check_database`, `apply_session_schema`, and
`verify_session_storage`) and their dependency chain are unchanged between
states. The captured `apply_session_migration` run changes only the
`schema_version` job parameter from `v1` to `v2`; the recorded run result is
SUCCESS. This is an immutable run-parameter/recreate effect, not a functional
migration. No task performs SQL, initializes storage, calls an LLM, or creates
traces. The App source is a standard-library-only static HTTP response, not an
agent implementation. The captured App experiment binding is not evidence of
created traces.

The serving endpoint and catalog are external shared resources. The App,
experiment, Lakebase project and its implicit branch/primary endpoint, role,
database, job, and run are bundle resources for this showcase. The earlier
baseline deployment generated an App service principal (captured managed ID
`73812729905760`); it is not an independently declared bundle identity. That
baseline cleanup found the bundle root, App, project, job, and generated
principal absent, and the experiment deleted by ID. The first immediate App
lookup showed `DELETING`; a later metadata lookup was absent. App deletion is
asynchronous, so the immediate state is not itself proof of completed deletion.
Experiment lifecycle deletion and absence from lookup do not claim physical purge
or deletion of retained artifacts/run history. Bundle state removal alone is
not evidence of service resource or history purge.

Destroying this fixture must not delete the shared serving endpoint, catalog,
or App-generated principal as a separately managed identity. Do not treat
historical IDs or retained run records as authority to delete anything. The
plan is an independently reviewed genuine capture, not a synthetic plan or
proof of behavior beyond these observed resources and operations.
