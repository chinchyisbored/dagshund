---
name: update-fixtures
description: >
  Regenerate dagshund golden fixtures against a new Databricks CLI version.
  Regenerates fixtures in the Nix development shell, walks the user through
  the manual-drift fixture, triages cosmetic vs substantive drift, blesses
  new expected output, updates
  README + screenshots, and commits.
---

# Update Fixtures Workflow

Follow these steps in order. Stop and report if any step fails. Fixture
regeneration hits a real Databricks workspace — be deliberate. Run every
command through `nix develop --command`; use `nix develop --command bash -c`
when a step needs shell syntax. Never use tools inherited from the host
environment.

## Step 1: Guards

1. Run `nix develop --command git status` — working tree must be clean (stash or commit first).
2. Run `nix develop --command databricks auth profiles` — the DEFAULT profile must show `Valid: YES`.
   If not, ask the user to run `nix develop --command databricks auth login --host <workspace-url>`
   interactively, then re-verify. Never attempt to bypass the authentication prompt.

## Step 2: File a tracking bead

`nix develop --command br create "regen fixtures on Databricks CLI X.Y.Z" -t chore -p 2`, then
`nix develop --command br update <id> --description "..."` with:
- Which CLI version and what released
- Steps 1–N of this workflow
- Workspace prerequisites (catalog, schemas, groups, SQL warehouse)

Mark `in_progress`.

## Step 3: Regenerate the bundle schema

```bash
nix develop --command bash -c \
  'databricks bundle schema > fixtures/golden/bundle_config_schema.json'
```

This file is gitignored — not committed, but regenerate to keep the
yaml-language-server validation accurate.

## Step 4: Regenerate unattended fixtures

```bash
nix develop --command just regen
```

This runs a full deploy/plan/destroy cycle for fixtures that can regenerate
without human intervention. Timeout liberally (600s). `regen.sh --all` skips
supervised fixtures and prints their follow-up commands.

`wheel-bump` is also skipped by `--all`: it needs classic compute (job
clusters with task libraries), which the default fixture workspace
(serverless-only) rejects. It does NOT regenerate as part of a routine CLI
refresh — regenerate it ad hoc with `nix develop --command just regen wheel-bump` against a
workspace that allows job clusters, then `nix develop --command just gen-expected wheel-bump`.
During a routine refresh, leave its `plan.json` untouched; only re-bless its
expected output if `nix develop --command just test-golden` flags drift from dagshund's own
rendering changes.

**Do not run `nix develop --command just regen` or `nix develop --command just dev` as background tasks** — they hang on
TaskOutput polling.

## Step 5: Regenerate supervised fixtures

### manual-drift

`regen.sh` can't generate manual-drift because it requires UI edits between
deploy and plan. Follow `fixtures/golden/manual-drift/README.md` literally:

1. Run `nix develop --command bash -c 'source fixtures/golden/.env && cd fixtures/golden/manual-drift/before && databricks bundle deploy'` so `BUNDLE_VAR_secondary_user` is set.
2. Tell the user to make **7 UI edits** in the workspace:
   - Delete the `transform` task from `drift_pipeline`
   - Change `publish`'s dep from `transform` → `ingest`
   - Unlock edit mode on the job (set editable)
   - Drop `dagshund.drift_doomed` schema entirely
   - On `dagshund.drift_grants`, revoke every privilege from `data_engineers`
   - On `dagshund.drift_grants`, revoke only `SELECT` from `data_readers` (leave `USE_SCHEMA`)
   - On `dagshund.drift_grants`, grant `USE_SCHEMA` and `SELECT` to `account users`
3. **Wait for explicit confirmation** from the user that all 7 edits are done.
4. **Wipe stale local state in `after/.databricks/` before planning**. If `after/.databricks/` contains state from a previous run, `databricks bundle plan` can emit everything as `action: create` with no `remote_state` block. `regen.sh` avoids this by removing both `before/.databricks/` and `after/.databricks/` at the start of each fixture run; the manual flow has to do it explicitly:

   ```bash
   nix develop --command rm -rf fixtures/golden/manual-drift/after/.databricks
   ```

5. Run `nix develop --command bash -c 'cd fixtures/golden/manual-drift/after && databricks bundle plan -o json | python3 ../../../tooling/sanitize.py > ../plan.json'` — sanity-check that drift_pipeline is `update` (not `create`) and drift_grants.grants has a `remote_state` block. If you see all-creates with only `new_state`, step 4 was missed.
6. Run `nix develop --command bash -c 'cd fixtures/golden/manual-drift/after && databricks bundle deploy'` if reconciling the drift before destroy.
7. Run `nix develop --command bash -c 'cd fixtures/golden/manual-drift/after && databricks bundle destroy --auto-approve'`.

## Step 6: Classify drift

```bash
nix develop --command just test-golden
```

For every failing fixture, compare the current dagshund output against the
stored expected file **with the CLI version masked**:

```bash
nix develop --command bash -c '
sed -E '\''s/cli [0-9.]+/cli X.Y.Z/'\'' fixtures/golden/<name>/expected.txt \
  | diff -u - <(uv run python -m dagshund fixtures/golden/<name>/plan.json 2>&1 \
    | sed -E '\''s/cli [0-9.]+/cli X.Y.Z/'\'')
'
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

**Do not run `nix develop --command just gen-expected` without explicit user approval.** Confirmation
of analysis is not approval for action (see memory
`feedback_context_is_not_approval`). Wait for a clear go-ahead word.

## Step 8: Bless new expected output

```bash
nix develop --command just gen-expected
```

Writes fresh `expected.txt`, `expected.md`, `expected-exit.txt`, and
`expected-graph.json` for every fixture, plus `expected-suppressed.txt` /
`expected-suppressed.md` for fixtures where `--suppress-wheel-updates`
changes the output (currently only wheel-bump).

## Step 9: Run the full quality gate

```bash
nix develop --command just check
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
- `wheel_updates.png` — wheel-bump terminal output, spliced before/after composite (plain vs `--suppress-wheel-updates`, red arrow between)
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
`nix develop --command just dev` in the browser. Do **not** try to regenerate screenshots yourself.

For terminal screenshots (`terminal.png`, `drift.png`): same — user captures
manually from a terminal running dagshund against the relevant fixture.

`pr_comment.png` has a special MR-based workflow — see step 14.

## Step 12: Browser verification

`nix develop --command just dev <path-to-plan.json>` — load a substantive fixture and confirm
the browser rendering looks sane. `nix develop --command just dev-down` to stop. Per
`.agents/guidelines/WORKFLOW.md`, a passing `nix develop --command just build` does not guarantee a
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

1. Complete the 3-pass review and present the diff summary, review outcome,
   verification, intended bead closure, commit, push, and MR actions.
2. Pause for explicit user approval before closing the bead, committing, or
   pushing. Acknowledgement or screenshot discussion is not approval.
3. Close the tracking bead with the approved reason, then run
   `nix develop --command br sync --flush-only` so its closure rides the
   feature commit.
4. Stage the fixtures, README, test updates, skill changes, and `.beads/`.
   **Do not** stage a new `pr_comment.png` yet. Verify with
   `nix develop --command git status`, then commit with a message like
   `fixtures(cli X.Y.Z): regenerate goldens`.
5. Push the feature branch and open the MR using the standard commands in
   `.agents/guidelines/WORKFLOW.md`.
6. **Post the dagshund markdown output as its own MR note, not in the
   description.** Run a representative fixture through dagshund in md mode:

   ```bash
   nix develop --command uv run python -m dagshund \
     fixtures/golden/<representative>/plan.json --format md
   ```

   Post the output as a separate non-resolvable MR comment via
   `nix develop --command glab mr note create <iid> --message "..." --resolvable=false`. The description stays reserved for
   the normal summary and test plan. The markdown dump is transient content
   captured by the screenshot. `mixed-changes` is a good pick because it has
   creates, updates, deletes, and drift warnings.
7. Wait for the user to screenshot the rendered markdown note and save it
   to `docs/pictures/pr_comment.png`.
8. After explicit user approval for this final MR update, stage only the new
   screenshot with `nix develop --command git add docs/pictures/pr_comment.png`,
   verify with `nix develop --command git status`, commit with
   `nix develop --command bash -c 'source .venv/bin/activate && git commit -m "docs: refresh pr_comment.png for cli X.Y.Z"'`,
   then push with `nix develop --command git push`.
9. Wait for the user to confirm, then **delete the markdown-dump MR note**
   via the MR UI or
   `nix develop --command glab mr note delete <iid> <note-id> --yes`. The
   screenshot lives in the repo now; the raw markdown comment was only a fixture.
10. Verify the MR title is a conventional commit subject, for example
    `fixtures(cli X.Y.Z): regenerate goldens`. GitLab uses the MR title as the
    squash commit subject on `main`.
11. Report the MR URL and hand it off to the user. Do not poll the pipeline or
    merge the MR. The user handles the pipeline and squash merge in GitLab.

Never push to `main`. Never skip the MR.
