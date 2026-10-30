# Cleanup and job-run triggers (supervised live fixture)

This technical fixture records Databricks CLI 1.20.0 `direct` behavior for state-only cleanup and modern job-run triggers. It uses the existing fixture workspace and `DEFAULT` profile. It is not part of unattended fixture regeneration. Run commands below from the repository root through `direnv exec .`. Stop if `.envrc` requires approval or a command needs interactive authentication.

## Supervised capture and resume

The steps below describe the capture workflow. The capture recorded here is complete; do not repeat deployment, schema deletion, capture, expectation generation, or teardown as part of routine checks.

1. **Check identity and validate both configurations.** From the repository root:

   ```sh
   direnv exec . bash -c 'databricks version; databricks auth profiles'
   direnv exec . bash -c 'cd fixtures/golden/cleanup-job-run-triggers/before && databricks bundle validate --profile DEFAULT -o json'
   direnv exec . bash -c 'cd fixtures/golden/cleanup-job-run-triggers/after && databricks bundle validate --profile DEFAULT -o json'
   ```

   Confirm CLI 1.20.0, `DEFAULT` at `https://dbc-c1c0b013-636f.cloud.databricks.com`, engine `direct`, the exact bundle name `dagshund-golden-cleanup-job-run-triggers-aqde`, and root `/Workspace/Users/${workspace.current_user.userName}/.bundle/${bundle.name}/default`. Confirm the only job is `dagshund-cleanup-job-run-triggers-aqde`, and that the before/after resource difference is the schema and `one_off` run entry. Do not publish raw validation output containing user details. Before any first deployment, verify that this exact schema, job, and root are absent or demonstrably owned by this approved fixture invocation. A collision or mismatch is a stop condition.

2. **Deploy the baseline once.** Only after the identity, permission, and inventory gates pass, from `before/` run:

   ```sh
   direnv exec . bash -c 'cd fixtures/golden/cleanup-job-run-triggers/before && databricks bundle deploy --profile DEFAULT'
   direnv exec . bash -c 'cd fixtures/golden/cleanup-job-run-triggers/before && databricks bundle summary --profile DEFAULT --force-pull -o json'
   ```

   Record the fixture job ID and run IDs from the summary. Check each exact run with `databricks jobs get-run <RUN_ID> --profile DEFAULT -o json`, and check only this job for active runs with `databricks jobs list-runs --job-id <FIXTURE_JOB_ID> --active-only --profile DEFAULT -o json`. All three `one_off`, `file_change`, and `every_deploy` runs must succeed and no fixture run may remain active. Stop on a failed, skipped, active, or uncertain run. Do not blindly redeploy: `every_deploy` fires again.

3. **Pause for the human-only schema deletion.** Confirm that `dagshund.cleanup_job_run_triggers_aqde` is empty. The user, not the capture operator, deletes only that schema outside the bundle, using Catalog Explorer or this command in the repository environment:

   ```sh
   direnv exec . databricks schemas delete dagshund.cleanup_job_run_triggers_aqde --profile DEFAULT
   ```

   Do not use `--force` or cascade. Wait for the user to explicitly confirm completion. Then verify read-only that this exact schema is absent before resuming; if it remains or absence is unclear, stop and ask the user. Never perform or repeat the manual deletion yourself.

4. **Plan from `after/` without deploying it.** Before the first plan only, remove a stale *local* cache if it exists. This must not touch remote bundle state or `before/`:

   ```sh
   direnv exec . bash -c 'cd fixtures/golden/cleanup-job-run-triggers/after && if [ -d .databricks ]; then rm -rf .databricks; fi'
   ```

   Capture to a temporary file; `pipefail` ensures sanitizer or CLI failures cannot be mistaken for a valid plan:

   ```sh
   direnv exec . bash -c 'cd fixtures/golden/cleanup-job-run-triggers/after && set -o pipefail && databricks bundle plan --profile DEFAULT -o json | python3 ../../../tooling/sanitize.py > ../plan.json.tmp && python3 -m json.tool ../plan.json.tmp'
   ```

   Review the temporary plan for private or unexpected content without changing semantic fields. Only after successful command completion, valid JSON, and privacy review, replace the tracked capture:

   ```sh
   direnv exec . bash -c 'mv fixtures/golden/cleanup-job-run-triggers/plan.json.tmp fixtures/golden/cleanup-job-run-triggers/plan.json'
   ```

   Inspect the genuine plan for schema `delete` + `gone: true`, `one_off` `delete` + `state_only: true`, `file_change` and `every_deploy` recreation under `lifecycle.triggers_state`, and unchanged job/task. Stop and retain the actual sanitized evidence for review if any behavior is missing or unexpected. Never synthesize plan fields. Never run `bundle deploy` from `after/`.

5. **Review and approve output before generation.** Inspect terminal, Markdown, detailed-exit, and graph/browser output using the repository's fixture checks. Present actual deltas and previews for explicit approval. Only after approval, generate this fixture's expectations:

   ```sh
   direnv exec . just gen-expected cleanup-job-run-triggers
   ```

   The actual capture and output for this fixture were approved in implementation record comment 851; expectations were generated for this fixture only. No other fixture was blessed.

6. **Teardown only with separate authorization.** Recheck the exact fixture inventory and confirm there are no active runs, using the scoped `list-runs` command in step 2. Obtain explicit authorization for fixture teardown. From `after/`, run only against the unchanged isolated bundle/root:

   ```sh
   direnv exec . bash -c 'cd fixtures/golden/cleanup-job-run-triggers/after && databricks bundle destroy --profile DEFAULT --auto-approve'
   ```

   Verify read-only that the exact job is absent, the schema remains absent, and `workspace get-status` for the exact configured bundle root reports that it does not exist. Stop on unexpected inventory, uncertain ownership, authentication failure, or residual-resource errors. Do not use force-lock, force/cascade, broad cleanup, or deploy after-state. Job teardown can remove its run history; do not describe that as preserved.

Stop at any stage on workspace/profile mismatch, collision, nonempty schema, failed or active baseline run, unexpected plan, authentication prompt, or uncertain teardown ownership. Do not use `regen.sh`: it deliberately refuses this fixture because it would bypass the human deletion gate and apply after-state.

## Provenance and completed outcome

Baseline deployed 2026-10-27 with Databricks CLI 1.20.0, engine `direct`, profile `DEFAULT`, workspace `https://dbc-c1c0b013-636f.cloud.databricks.com`. The three fixture runs terminated successfully: `file_change` 1041732527553192, `one_off` 585863985368898, and `every_deploy` 803377418880214. Fixture job ID: 971607388943390; no active runs remained.

The user reported performing the schema deletion (implementation record comment 849). A read-only lookup in `DEFAULT` returned `Schema 'dagshund.cleanup_job_run_triggers_aqde' does not exist` before planning. The sanitized live plan in `plan.json` was captured from `after/` on 2026-10-27, before any after-state deployment. It contains schema `delete` + `gone: true`; `one_off` `delete` + `state_only: true`; recreated `every_deploy` and `file_change` entries under `lifecycle.triggers_state`; and an unchanged job/task. The `file_change` fingerprint changed for `watched.txt`. No trigger hashes or UUIDs are asserted by tests. Actual output approval is recorded in comment 851.

With separate authorization in comment 853, teardown ran from `after/` on 2026-10-27 and exited 0, deleting the fixture job. Read-only postchecks confirmed that job 971607388943390 is absent, the schema remains absent, and the exact bundle root does not exist. No after-state deployment or broad cleanup was performed. Final focused tests, all JavaScript tests, all golden checks, `just check`, and `just build` passed; see implementation record comment 854 and retained evidence under `/home/chinchy/.local/share/dagshund/workflow-evidence/aqde/capture-approved/`.
