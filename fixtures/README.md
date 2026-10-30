# Fixtures

Most deployable golden fixtures are sanitized captures of `databricks bundle plan -o json` from a real Databricks workspace. `synthetic-ai-gateway` is a constructed, plan-only input for unavailable services; it is not a workspace capture or deployment config. Both fixture classes use the existing JS and Python plan consumers, but synthetic `cli_version` values identify a targeted contract, not a generating CLI run. See [COVERAGE.md](COVERAGE.md) for the pinned CLI 1.20 resource and behavior evidence matrix, limits, and pending feature-gap handoff. The ordered `showcases.json` manifest selects the examples published in the Pages gallery. It does not limit regression coverage: Python and JavaScript tests and `just test-golden` continue to discover every plan under `golden/`.

Run every fixture maintenance command from the repository root through `direnv exec .`; `.envrc` loads the declared toolchain.

## Directory structure

```
fixtures/
  golden/
    bundle_config_schema.json # Generated schema for YAML language server (gitignored)
    <name>/
      before/databricks.yaml # Bundle config for baseline (deployed first)
      after/databricks.yaml  # Bundle config for changed state (planned against baseline)
      plan.json              # Captured plan, or a documented constructed plan-only input
      README.md               # Provenance and limitations for synthetic fixtures
      expected.txt           # Expected CLI text output
      expected.md            # Expected CLI markdown output
      expected-suppressed.txt # Text output with --suppress-wheel-updates; only present when it differs from expected.txt
      expected-suppressed.md # Markdown output with --suppress-wheel-updates; only present when it differs from expected.md
      expected-exit.txt      # Expected detailed exit code (-e)
      expected-graph.json    # Expected structural graph summary (browser graph builder)
  tooling/
    regen.sh                 # Deploy/plan/capture/sanitize/destroy orchestration
    generate_expected.sh     # Generate or --check expected.txt + expected.md
    sanitize.py              # Deterministic email-only PII sanitizer (stdin -> stdout)
```

## Synthetic AI Gateway fixture

`golden/synthetic-ai-gateway/` has a constructed `plan.json` and provenance README, with no `before/` or `after/` deployment configs. Its fictional service identities and external references cover schema-scoped model, provider, and MCP services; routing; connection references; named service credentials; and grant subresources. It targets CLI 1.20.0 source/schema and SDK v0.185.0 contracts. It does not establish DAB acceptance, backend normalization, deployment behavior, or service availability. See its README for source links and exact limits.

Do not add synthetic-only plans to the deployable regeneration set. Existing Python and JavaScript public fixture consumers discover plan files without requiring deployment configs.

## Semantic JS contract fixtures

Narrow JSON vectors under `js/tests/` exercise named TypeScript consumers. They are not regenerated
from a Databricks workspace and do not replace the shared golden plans above:

| Contract vectors | Consumer tests |
|---|---|
| `js/tests/utils/effective-state-cases.json` | `js/tests/utils/effective-resource-state.test.ts`, `js/tests/graph/effective-resource-state.test.ts` |
| `js/tests/utils/merged-effect-cases.json` | `js/tests/utils/normalize-plan.test.ts` |
| `js/tests/parser/action-diff-state-cases.json` | `js/tests/parser/map-diff-state.test.ts` |
| `js/tests/preparation/prepared-task-cases.json` | `js/tests/preparation/prepare-job.test.ts` |
| `js/tests/graph/reference-outcome-cases.json` | `js/tests/graph/resolve-references.test.ts` |
| `js/tests/graph/target-pair-cases.json` | `js/tests/graph/extract-lateral-edges.test.ts` |
| `js/tests/utils/phantom-identity-cases.json` | `js/tests/utils/resource-key.test.ts` |
| `js/tests/utils/drift-decision-cases.json` | `js/tests/utils/structural-diff.test.ts` |

`fixtures/job-run-effect-cases.json` and `fixtures/job-run-outcome-cases.json` are shared by
JavaScript and Python tests. Other shared semantic vectors include
`fixtures/list-element-semantic-cases.json` and `fixtures/wheel-update-cases.json`. Browser-only
preparation, graph identity/phantom, and drift-policy vectors describe JavaScript behavior; they do
not define Python safety-analysis rules. The shared job-run effect cases can also have different
orphan presentation: the browser retains orphan effect groups for graph display, while Python's
standalone handling remains unchanged. See `.agents/guidelines/VISUALIZATION.md` for the browser
pipeline and relationship semantics.

## Bundle schema

All `databricks.yaml` files reference a local bundle schema for editor validation. Generate it once:

```bash
direnv exec . bash -c \
  'databricks bundle schema > fixtures/golden/bundle_config_schema.json'
```

This file is gitignored — regenerate it after upgrading the Databricks CLI.

## Prerequisites

- Databricks CLI >= 0.296.0 with `engine: direct`
- Authenticated CLI profile (tooling uses the default profile)
- Python 3.12+ (for sanitize.py)

## Workspace setup

Live fixture regeneration uses a real Databricks workspace. The following resources must exist before running it; they are external prerequisites, not resources created by the fixture bundle configs.

| Resource | Type | Purpose |
|---|---|---|
| `dagshund` | Catalog | All schemas and volumes live under this catalog |
| `dagshund.models` | Schema | Pre-existing schema for registered_models |
| `/Workspace/experiments` | Directory | Experiment resources require an absolute workspace path |
| `admins` | Group | Job permissions (sub-resources fixture) |
| `viewers` | Group | Job permissions (sub-resources fixture) |
| `data_engineers` | Group | Schema grants (sub-resources fixture) |
| `data_readers` | Group | Schema grants (sub-resources fixture) |
| `data_analysts` | Group | Schema grants (sub-resources fixture) |
| `phantom_job` | Job | Serverless no-op job outside any bundle, targeted by the job-runs fixture's phantom run entry. Its id is the `external_job_id` variable in `externals.yaml`. |
| `phantom-lineage-lakebase` | Lakebase project with a `production` branch | External source branch referenced by `lakebase-autoscaling`; retained as a fixture prerequisite, not created or destroyed by the bundle. |
| `dagshund.phantom_schema.phantom_table` | Unity Catalog table | Source for the Lakebase synced-table fixture. |

Starter SQL warehouse (`9d0afa601cb95187`) is used by the app-dependencies fixture for lateral edge testing.

## Regenerating fixtures

Regeneration runs a full deploy/plan/capture/destroy cycle against a real workspace. Local only, never runs in CI.

```bash
direnv exec . just regen <fixture-name>   # One fixture
direnv exec . just regen                  # All unattended fixtures
```

`direnv exec . just regen` skips fixtures that cannot regenerate unattended against the default workspace:

| Fixture | Regeneration path |
|---|---|
| `manual-drift` | Follow `fixtures/golden/manual-drift/README.md`. It requires workspace UI edits between deploy and plan. |
| `cleanup-job-run-triggers` | Supervised live CLI 1.20 fixture. Requires user deletion of one empty fixture-owned schema between baseline deploy and plan; see its README. Never run through unattended regeneration. |
| `wheel-bump` | Needs classic compute (job clusters with task libraries); the default fixture workspace is serverless-only. Regenerate ad hoc with `direnv exec . just regen wheel-bump` against a workspace that allows job clusters, then `direnv exec . just gen-expected wheel-bump`. |

`lakebase-autoscaling` is part of the unattended `direnv exec . just regen` set. It requires the external `phantom-lineage-lakebase` project with a `production` branch, plus the UC source table listed above. Keep these prerequisites outside the fixture bundle lifecycle. If a Lakebase endpoint is left list-visible but not get/delete-addressable, clean up that endpoint before rerunning only the affected fixture.

`job-runs` regenerates unattended but needs Databricks CLI 1.7.0+ (`resources.job_runs`
is experimental) and its deploys really fire the runs they declare: eight tiny
serverless notebook runs across the before/after deploys, one of which fires on the
pre-existing `phantom_job` outside the bundle. Runs can queue on serverless capacity
for a few minutes; `regen.sh` drains active runs before bundle steps that may delete
runs. With Databricks CLI 1.20, removing or recreating a `job_runs` entry does not call
`jobs/runs/delete`, and dropping bundle state does not erase the external job's run
history. The drain remains because older CLI versions and job-resource teardown may
delete runs.

After regeneration and explicit approval of the reviewed output changes, update expected dagshund output with `direnv exec . just gen-expected <fixture-name>`. Do not bless mismatches without reviewing their meaning.

## CLI compatibility limits

A live fixture refresh checks only the captured plans; it does not establish general CLI compatibility. See [COVERAGE.md](COVERAGE.md) for captured provenance, offline graph contracts, and remaining service limits. Offline test success does not establish backend availability or runtime readiness.

`wheel-bump` remains a historical CLI 1.6.0 plan because the default serverless workspace cannot regenerate its classic-compute fixture. Do not relabel or refresh it as CLI 1.20 without the separately scoped workspace and review.

## Checking expected output

`direnv exec . just test-golden` (also part of `direnv exec . just check`) diffs current CLI output against the stored `expected.txt` / `expected.md` for every fixture. This check is also a normal commit hook, alongside both unit suites and the existing lint/format/typecheck hooks. It also runs `--suppress-wheel-updates` in both formats: fixtures with a stored `expected-suppressed.txt` / `expected-suppressed.md` are diffed against those, and all others are diffed against the plain expected files, asserting that suppression is a no-op there.

Every change must pass `just check`, which runs all hooks defined in `prek.toml` using `uv run prek run --all-files`. The fixture-specific commands here are maintenance or diagnostic tools, not substitutes for that gate. Stage intended additions first so they are included. If hooks fix files, inspect and restage the changes before rerunning. Review the final diff after success. Prek prints failures directly; use `--verbose` when retaining successful hook output in a log. Golden checks never regenerate expectations.

```bash
direnv exec . just test-golden
```

Exits 0 on match and 1 on any mismatch or missing file.

## Sanitization

`sanitize.py` replaces email addresses with deterministic fakes (`user1@example.com`, `user2@example.com`, ...). UUIDs, numeric IDs, and timestamps pass through untouched. Same input always produces the same output.

```bash
direnv exec . bash -c \
  'python3 fixtures/tooling/sanitize.py < raw-plan.json > sanitized-plan.json'
```

Sanitization is called automatically by `regen.sh`. You only need to run it directly if processing plans manually.
