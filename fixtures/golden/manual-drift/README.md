# manual-drift

This fixture requires manual intervention — it cannot be regenerated with `regen.sh`.

Drift means the remote resource was edited in the Databricks UI after bundle deployment, so the plan detects differences even though the bundle config hasn't changed.

## Steps

### 1. Deploy the bundle

```bash
cd fixtures/golden/manual-drift/before
databricks bundle deploy
```

### 2. Introduce drift in the Databricks UI

Open the workspace and make these changes.

**On the `drift_pipeline` job:**

1. **Delete the `transform` task** entirely
2. **Change `publish`'s dependency** from `transform` to `ingest`
3. **Unlock edit mode** (set the job to editable / remove bundle lock)

**On the Unity Catalog schemas** — these cover all three drift dimensions:

4. **Whole-resource drift.** Drop `dagshund.drift_doomed` entirely (bundle has
   it, remote does not).
5. **Whole sub-entity drift.** On `dagshund.drift_grants`, revoke every
   privilege belonging to `data_engineers` so that principal's grant
   disappears from the remote entirely.
6. **Partial sub-entity drift.** Also on `dagshund.drift_grants`, revoke only
   `SELECT` from `data_readers`, leaving `USE_SCHEMA` in place.

### 3. Capture the plan

```bash
cd fixtures/golden/manual-drift/after
databricks bundle plan -o json \
  | python3 ../../../tooling/sanitize.py > ../plan.json
```

### 4. Destroy

```bash
databricks bundle destroy --auto-approve
```

### 5. Generate expected output

```bash
just gen-expected manual-drift
```

## Scope limitation: whole-resource drift (`drift_doomed`)

The `drift_doomed` schema exercises the whole-resource drift case, but
Databricks collapses a missing-from-remote top-level resource to
`action: "create"` with no `remote_state` block. That shape is
indistinguishable from a brand-new resource in `plan.json` alone, so
dagshund's topology-drift detector correctly renders it as a plain create
and does **not** flag it with the `drift` modifier.

The schema is retained in the fixture as a negative smoke test: it
confirms the detector does NOT false-positive on create actions. Fixing
this case would require ingesting `state/metadata.json` from the
workspace, which is out of scope — dagshund operates on the plan file and
nothing else.
