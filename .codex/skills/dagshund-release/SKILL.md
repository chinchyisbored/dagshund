---
name: dagshund-release
description: Release workflow for the dagshund project. Use when the user asks Codex to cut, prepare, automate, or walk through a dagshund release, including version bumps, release branches, GitLab merge requests, tags, release notes, and publish pipeline handoff.
---

# Dagshund Release

Use the canonical, agent-neutral runbook in the dagshund repository.

## Contract

Use when the user asks to release dagshund, bump the project version, prepare a
release branch or MR, create release notes, tag a release, or hand off the
publish pipeline.

Do not use for ordinary feature work, bug fixes, fixture regeneration, local
testing, dependency updates, or plugin development unless that work is part of
an active release run.

Required inputs:
- A clean dagshund checkout on `main`.
- The user's chosen semver bump: patch, minor, or major.
- Explicit user approval for the tag message, merge, and release notes.

External tools and services:
- `git`, `just`, `glab`, GitLab CI, and the dagshund release pipeline.

Successful output:
- A version bump MR is squash-merged into `main`.
- An annotated `vX.Y.Z` tag points at the squashed release commit.
- A GitLab release is created with approved notes.
- The user is told which manual publish jobs remain available.

Failure behavior:
- Stop at the failing guard or command.
- Explain what failed and what state the repo, MR, tag, or pipeline is in.
- Do not skip ahead or substitute a different release path.

Routing examples:
- "cut a patch release" uses this skill.
- "bump dagshund to 1.2.0" uses this skill.
- "fix the graph layout bug" does not use this skill.

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
