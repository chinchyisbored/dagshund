---
name: dagshund-release
description: Release workflow for the dagshund project. Use when the user asks Codex to cut, prepare, automate, or walk through a dagshund release, including version bumps, release branches, GitLab merge requests, tags, release notes, and publish pipeline handoff.
---

# Dagshund Release

Use the canonical, agent-neutral runbook in the dagshund repository.

## Workflow

1. Locate the dagshund repository root.
2. Read `AGENTS.md` first for project rules.
3. Read `docs/workflows/release.md`.
4. Follow that workflow exactly, including its guard steps and required user approvals.

The workflow file is the source of truth. Do not duplicate or improvise release
steps in this skill; update `docs/workflows/release.md` if the process changes.

## Hard Stops

- Never release from an unclean worktree.
- Never push directly to `main`.
- Never merge or publish without the explicit approval required by the workflow.
