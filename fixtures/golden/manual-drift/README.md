# manual-drift

This fixture requires manual intervention — it cannot be regenerated with `regen.sh`.

Drift means the remote resource was edited in the Databricks UI after bundle deployment, so the plan detects differences even though the bundle config hasn't changed.

## Steps

### 1. Deploy the bundle

```bash
cd fixtures/golden/manual-drift/before
databricks bundle deploy
```

### 2. Edit the job in the Databricks UI

Open the `drift_pipeline` job in the workspace and make these changes:

1. **Delete the `transform` task** entirely
2. **Change `publish`'s dependency** from `transform` to `ingest`
3. **Unlock edit mode** (set the job to editable / remove bundle lock)

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
