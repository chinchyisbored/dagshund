---
name: update-fixtures
description: >
  Regenerate dagshund golden fixtures against a new Databricks CLI version.
  Re-runs `just regen`, walks the user through the manual-drift fixture,
  triages cosmetic vs substantive drift, blesses new expected output, updates
  README + screenshots, and commits.
---

# Update Fixtures Workflow

Follow these steps in order. Stop and report if any step fails. Fixture
regeneration hits a real Databricks workspace — be deliberate.

## Step 1: Guards

1. Run `git status` — working tree must be clean (stash or commit first).
2. Run `databricks auth profiles` — the DEFAULT profile must show `Valid: YES`.
   If not, ask the user to run `! databricks auth login --host <workspace-url>`
   from the session prompt, then re-verify.

## Step 2: File a tracking bead

`br create "regen fixtures on Databricks CLI X.Y.Z" -t chore -p 2`, then
`br update <id> --description "..."` with:
- Which CLI version and what released
- Steps 1–N of this workflow
- Workspace prerequisites (catalog, schemas, groups, SQL warehouse)

Mark `in_progress`.

## Step 3: Regenerate the bundle schema

```bash
databricks bundle schema > fixtures/golden/bundle_config_schema.json
```

This file is gitignored — not committed, but regenerate to keep the
yaml-language-server validation accurate.

## Step 4: Regenerate all fixtures

```bash
just regen
```

This runs a full deploy/plan/destroy cycle for every fixture. Timeout
liberally (600s). The `manual-drift` fixture will be clobbered — that's fine,
step 5 fixes it.

**Do not run `just regen` or `just dev` as background tasks** — they hang on
TaskOutput polling.

## Step 5: Redo the manual-drift fixture (together)

`regen.sh` can't generate manual-drift because it requires UI edits between
deploy and plan. Follow `fixtures/golden/manual-drift/README.md` literally:

1. `cd fixtures/golden/manual-drift/before && databricks bundle deploy`
   (source `fixtures/golden/.env` first so `BUNDLE_VAR_secondary_user` is set).
2. Tell the user to make **6 UI edits** in the workspace:
   - Delete the `transform` task from `drift_pipeline`
   - Change `publish`'s dep from `transform` → `ingest`
   - Unlock edit mode on the job (set editable)
   - Drop `dagshund.drift_doomed` schema entirely
   - On `dagshund.drift_grants`, revoke every privilege from `data_engineers`
   - On `dagshund.drift_grants`, revoke only `SELECT` from `data_readers` (leave `USE_SCHEMA`)
3. **Wait for explicit confirmation** from the user that all 6 edits are done.
4. **Wipe stale local state in `after/.databricks/` before planning** — `just regen` populates `after/.databricks/` during its own pass and leaves it behind. With stale local state present, `databricks bundle plan` consults the local cache instead of fetching the live workspace, and emits everything as `action: create` with no `remote_state` block. `regen.sh` avoids this by `rm -rf`'ing both `before/.databricks/` and `after/.databricks/` at the start of each fixture run; the manual flow has to do it explicitly:

   ```bash
   rm -rf fixtures/golden/manual-drift/after/.databricks
   ```

5. `cd ../after && databricks bundle plan -o json | python3 ../../../tooling/sanitize.py > ../plan.json` — sanity-check that drift_pipeline is `update` (not `create`) and drift_grants.grants has a `remote_state` block. If you see all-creates with only `new_state`, step 4 was missed.
6. `databricks bundle deploy` (optional — reconciles the drift cleanly before destroy)
7. `databricks bundle destroy --auto-approve`

## Step 6: Classify drift

```bash
just test-golden
```

For every failing fixture, `diff` the current dagshund output against the
stored expected file **with the CLI version masked**:

```bash
sed -E 's/cli [0-9.]+/cli X.Y.Z/' fixtures/golden/<name>/expected.txt \
  | diff -u - <(uv run python -m dagshund fixtures/golden/<name>/plan.json 2>&1 | sed -E 's/cli [0-9.]+/cli X.Y.Z/')
```

Bucket each fixture as:
- **Cosmetic only** — the only diff is the CLI version header line. The
  existing `normalize_cli_version` in `generate_expected.sh` should make these
  pass automatically; if they don't, something else is drifting.
- **Substantive** — real output changes (e.g. `depends_on` shape shifts, new
  fields, renamed keys).

Fixture directories with `before/` and `after/` bundle configs are expected to
be regenerated from Databricks CLI output. Loose files under `fixtures/golden/`
such as `broken-json.json` and `bundle_config_schema.json` are support inputs,
not golden fixture directories.

Present the breakdown to the user. For substantive changes, walk through the
diff and explain whether each is a CLI improvement, a regression, or a
dagshund bug. Link to any known CLI PR that caused the change.

## Step 7: Review with the user before blessing

**Do not run `just gen-expected` without explicit user approval.** Confirmation
of analysis is not approval for action (see memory
`feedback_context_is_not_approval`). Wait for a clear go-ahead word.

## Step 8: Bless new expected output

```bash
just gen-expected
```

Writes fresh `expected.txt`, `expected.md`, `expected-exit.txt`, and
`expected-graph.json` for every fixture.

## Step 9: Run the full quality gate

```bash
just check
```

Expect occasional test failures: Python or JS unit tests that hardcoded the
old CLI's output shape will break. Fix each by updating the assertion to
match the new (correct) shape — **never weaken the test** to make it pass.

## Step 10: Update the README

Edit `README.md` — update the "Last validated against Databricks CLI X.Y.Z"
line to the exact CLI version used for this fixture refresh.

Do not describe this as a minimum supported version. The fixture run validates
one Databricks CLI version, while nearby older or newer versions may still work
if their `databricks bundle plan -o json` shape is compatible.

## Step 11: Audit screenshots

Identify which `docs/pictures/*.png` are impacted by the CLI change. Common
cases:

- `terminal.png` — any fixture's terminal rendering
- `drift.png` — manual-drift terminal output
- `drift_web.png` — manual-drift browser detail panel
- `dag.png` — job task DAG visualization
- `schem_detail.png` — structural diff detail panel
- `resources.png` — resource graph
- `phantom_node.png` — phantom node rendering
- `lateral_dependencies.png` — lateral-deps fixture view
- `pr_comment.png` — PR comment rendering (special workflow, see step 14)

For the browser-based screenshots (`drift_web.png`, `schem_detail.png`,
`dag.png`, `resources.png`, `phantom_node.png`, `lateral_dependencies.png`):
tell the user they need a refresh and pause for them to recapture via
`just dev` in the browser. Do **not** try to regenerate screenshots yourself.

For terminal screenshots (`terminal.png`, `drift.png`): same — user captures
manually from a terminal running dagshund against the relevant fixture.

`pr_comment.png` has a special MR-based workflow — see step 14.

## Step 12: Browser verification

`just dev <path-to-plan.json>` — load a substantive fixture and confirm
the browser rendering looks sane. `just dev-down` to stop. Per
`docs/guidelines/WORKFLOW.md`, a passing `just build` does not guarantee a
working app.

## Step 13: File follow-up beads

If the CLI change exposed any dagshund code that was passively propagating
upstream bugs (e.g. lossy summaries, misleading framings), file a follow-up
bead for an audit pass. Example from CLI 0.298.0: `depends_on` shape fix
(PR #4990) dramatically improved the task-dag-rewiring fixture but the
detail-panel grouping logic needed review.

## Step 14: Commit and refresh pr_comment.png via the MR

`pr_comment.png` is captured from a real GitLab MR so the screenshot matches
what a user would actually see. Follow this extended flow:

1. 3-pass review
2. Stage specific files — fixtures, README, test updates, skill itself. Do
   **not** stage a new `pr_comment.png` yet.
3. Commit with a message like `fixtures(cli X.Y.Z): regenerate goldens`
4. Push the feature branch and open the MR
5. **Post the dagshund markdown output as its own MR note (not in the
   description).** Run a representative fixture through dagshund in md mode:

   ```bash
   uv run python -m dagshund fixtures/golden/<representative>/plan.json --format md
   ```

   Post the output as a separate MR comment via
   `glab mr note <iid> --message "..."`. The description stays reserved for
   the normal summary + test plan — the markdown dump is transient content
   captured by the screenshot. `mixed-changes` is a good pick (creates,
   updates, deletes, and drift warnings all in one).
6. Wait for the user to screenshot the rendered markdown note and save it
   to `docs/pictures/pr_comment.png`.
7. Commit the new screenshot and push again:
   `git add docs/pictures/pr_comment.png && git commit -m "docs: refresh pr_comment.png for cli X.Y.Z"`
8. Wait for the user to confirm, then **delete the markdown-dump MR note**
   (via the MR UI or `glab mr note delete <iid> <note-id>`). The screenshot
   lives in the repo now; the raw markdown comment was only a fixture.
9. Wait for the pipeline to go green, then `glab mr merge --squash` (with
   explicit user approval — see `feedback_context_is_not_approval`).
10. `br close <tracking-bead-id>` only after merge.

Never push to `main`. Never skip the MR.
