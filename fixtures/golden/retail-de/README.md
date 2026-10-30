# Retail DE orchestration and file-arrival fixture

This fixture demonstrates a paused daily job workflow and a separate file-arrival workflow. It does not implement snapshot or Type-2 business logic.

`plan.json` is the genuine Databricks CLI 1.20.0 capture from the successful unchanged `just regen retail-de` cycle, with the corrected `cascade_on_destroy: false` definitions. Its SHA-256 is `16a0f8a4f60ae458f47a7a8295c4b2ab49bea2869cc376cc8c8c733c44c205a3`; immutable copy: `~/.local/share/dagshund/workflow-evidence/m1oo/6/retail-de-normal-cycle-1093.json`. The cycle, fresh render, named golden check, and direct cleanup verification are recorded in `dagshund-m1oo.6` comments 1094 and 1096. The earlier genuine capture remains preserved separately at `~/.local/share/dagshund/workflow-evidence/m1oo/6/retail-de-plan-1056.json` (SHA-256 `fec1cfc7fa50d780360c117d884e120fdc20c94f658fc82fbd557993c47f906f`); it predates the explicit cascade correction and is historical evidence only. Do not alter or remove either retained capture.

## Inventory and boundaries

Before and after configurations share bundle identity `dagshund-golden-retail-de`, workspace `https://dbc-c1c0b013-636f.cloud.databricks.com`, and the caller-specific root `/Workspace/Users/${workspace.current_user.userName}/.bundle/${bundle.name}/default`.

The fixture owns three schemas (`dagshund.retail_bronze`, `dagshund.retail_silver`, and `dagshund.retail_gold`), six jobs, and four baseline pipelines. The after configuration adds `store_history` and a `data_analysts` grant on the gold schema. All nine before/after pipeline definitions explicitly set `cascade_on_destroy: false`; a focused Python test checks this configuration.

The daily 06:00 UTC job orchestrates bronze, silver, and history jobs. Bronze For Each concurrency changes from 2 to 5 and adds stores. The separate file-arrival job watches `/Volumes/dagshund/models/a_volume/retail/` and runs two ordinary notebook tasks before the file-history job. Keep that branch disconnected from the daily orchestrator.

The catalog, `dagshund.models` schema, MANAGED volume `dagshund.models.a_volume`, and its `/retail/` directory are external prerequisites, not bundle-owned resources. They must not be removed or have their ACLs changed. The successful cycle verified cleanup only for resources owned by this fixture; these external objects retain caller ownership. All job triggers remain PAUSED. The fixture represents configuration and does not claim business execution.

To reproduce the approved fixture capture, run `direnv exec . just regen retail-de` from the repository root, then run `direnv exec . just test-golden`. This is a supervised live lifecycle, not an offline command: verify the documented workspace/profile, exact bundle identity and caller-specific root, absent-or-owned fixture resources, external prerequisites, paused triggers, and cleanup boundaries before deployment. Stop on any mismatch; do not remove the external catalog, schema, volume, or directory. Expected output was generated only for this fixture with `just gen-expected retail-de` after separate output approval.

## Capture and graph limits

The captured file-arrival trigger points at the external MANAGED volume, but the current resource graph does not contain the models schema, volume node, or trigger-to-volume relationship. `fixtures/COVERAGE.md` records the observed capture and the intended relationship separately, with follow-up `dagshund-92hu.1`. Do not fabricate graph references or encode this gap as desired absence.

`fixtures/tooling/regen.sh` remains the shared generator; no retail-specific generator behavior was added. The current captured plan and named expected outputs reflect the approved terminal and HTML output; the G1 graph relationship remains an observed gap, not a desired absence or a claim of completed graph support.
