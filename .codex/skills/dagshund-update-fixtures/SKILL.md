---
name: dagshund-update-fixtures
description: Fixture regeneration workflow for the dagshund project. Use when the user asks Codex to update, regenerate, refresh, or bless dagshund golden fixtures for a new Databricks CLI version, including manual-drift handling, expected output updates, README updates, screenshot audit, and follow-up beads.
---

# Dagshund Update Fixtures

Use the canonical, agent-neutral runbook in the dagshund repository.

## Contract

Use when the user asks to update, regenerate, refresh, or bless dagshund golden
fixtures for a Databricks CLI version, including manual-drift recreation,
expected output regeneration, README CLI baseline updates, screenshot audits,
or follow-up beads from fixture drift.

Do not use for ordinary unit-test fixture edits, synthetic sample data changes,
general Databricks feature work, release version bumps, or graph/UI bug fixes
unless those changes are part of an active CLI fixture regeneration run.

Required inputs:
- The target Databricks CLI version.
- A clean dagshund checkout.
- A valid Databricks `DEFAULT` auth profile.
- Workspace prerequisites required by the golden fixtures.
- Explicit user approval before blessing expected output or merging.

External tools and services:
- `databricks`, `just`, `br`, `git`, `glab`, GitHub releases, GitLab CI, and a
  live Databricks workspace.

Successful output:
- Golden fixtures are regenerated or deliberately left unchanged.
- Drift is classified as cosmetic, upstream CLI change, or dagshund bug.
- Expected outputs, README CLI baseline, and screenshots are updated where
  needed.
- Follow-up beads capture any unresolved dagshund work.

Failure behavior:
- Stop at the failing guard, Databricks operation, drift check, or quality gate.
- Preserve enough context for cleanup or retry.
- Do not bless expected output, close the tracking bead, or merge while drift is
  unexplained.

Routing examples:
- "regen fixtures for Databricks CLI 1.0.0" uses this skill.
- "bless new golden output after a CLI upgrade" uses this skill.
- "update one JS graph test fixture for a bug fix" does not use this skill.

## Workflow

1. Locate the dagshund repository root.
2. Read `AGENTS.md` first for project rules.
3. Read `docs/workflows/update-fixtures.md`.
4. Follow that workflow exactly, including its guard steps, live Databricks checks, manual-drift pause points, and required user approvals.

The workflow file is the source of truth. Do not duplicate or improvise fixture
regeneration steps in this skill; update `docs/workflows/update-fixtures.md` if
the process changes.

## Hard Stops

- Never run Databricks plan/deploy/destroy steps without the workflow's approval and auth checks.
- Never bless expected output with `just gen-expected` without explicit user approval.
- Never close the tracking bead before the workflow's merge criteria are satisfied.
