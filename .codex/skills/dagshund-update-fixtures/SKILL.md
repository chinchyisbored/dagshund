---
name: dagshund-update-fixtures
description: Fixture regeneration workflow for the dagshund project. Use when the user asks Codex to update, regenerate, refresh, or bless dagshund golden fixtures for a new Databricks CLI version, including manual-drift handling, expected output updates, README updates, screenshot audit, and follow-up beads.
---

# Dagshund Update Fixtures

Use the canonical, agent-neutral runbook in the dagshund repository.

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
