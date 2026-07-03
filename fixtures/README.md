# Fixtures

Golden test fixtures generated from real Databricks workspaces. These are deterministic, sanitized snapshots of `databricks bundle plan -o json` output used by both JS and Python test suites.

## Directory structure

```
fixtures/
  golden/
    bundle_config_schema.json # Generated schema for YAML language server (gitignored)
    <name>/
      before/databricks.yaml # Bundle config for baseline (deployed first)
      after/databricks.yaml  # Bundle config for changed state (planned against baseline)
      plan.json              # Sanitized plan output (the fixture)
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

## Bundle schema

All `databricks.yaml` files reference a local bundle schema for editor validation. Generate it once:

```bash
databricks bundle schema > fixtures/golden/bundle_config_schema.json
```

This file is gitignored — regenerate it after upgrading the Databricks CLI.

## Prerequisites

- Databricks CLI >= 0.296.0 with `engine: direct`
- Authenticated CLI profile (tooling uses the default profile)
- Python 3.12+ (for sanitize.py)

## Workspace setup

Fixtures are generated against a real Databricks workspace. The following resources must exist before running regeneration — they are **not** created by the bundle configs.

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

Starter SQL warehouse (`9d0afa601cb95187`) is used by the app-dependencies fixture for lateral edge testing.

## Regenerating fixtures

Regeneration runs a full deploy/plan/capture/destroy cycle against a real workspace. Local only, never runs in CI.

```bash
just regen <fixture-name>   # One fixture
just regen                  # All unattended fixtures
```

`just regen` skips fixtures that cannot regenerate unattended against the default workspace:

| Fixture | Regeneration path |
|---|---|
| `manual-drift` | Follow `fixtures/golden/manual-drift/README.md`. It requires workspace UI edits between deploy and plan. |
| `wheel-bump` | Needs classic compute (job clusters with task libraries); the default fixture workspace is serverless-only. Regenerate ad hoc with `just regen wheel-bump` against a workspace that allows job clusters, then `just gen-expected wheel-bump`. |

`lakebase-autoscaling` is part of the unattended `just regen` set. If it fails
because a Lakebase endpoint is left list-visible but not get/delete-addressable,
clean up the workspace endpoint and rerun the fixture.

After regenerating, update the expected dagshund output:

```bash
just gen-expected <fixture-name>
just gen-expected
```

## Checking expected output

`just test-golden` (also part of `just check`) diffs current CLI output against the stored `expected.txt` / `expected.md` for every fixture. It also runs `--suppress-wheel-updates` in both formats: fixtures with a stored `expected-suppressed.txt` / `expected-suppressed.md` are diffed against those, and all others are diffed against the plain expected files, asserting that suppression is a no-op there. For a single fixture:

```bash
./fixtures/tooling/generate_expected.sh --check <fixture-name>
```

Exits 0 on match, 1 on any mismatch or missing file, 2 on bad args.

## Sanitization

`sanitize.py` replaces email addresses with deterministic fakes (`user1@example.com`, `user2@example.com`, ...). UUIDs, numeric IDs, and timestamps pass through untouched. Same input always produces the same output.

```bash
python3 fixtures/tooling/sanitize.py < raw-plan.json > sanitized-plan.json
```

Sanitization is called automatically by `regen.sh`. You only need to run it directly if processing plans manually.
