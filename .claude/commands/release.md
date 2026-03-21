---
name: release
description: >
  Automated release workflow for dagshund. Bumps version, runs quality gates,
  commits, tags, pushes, and creates a GitLab release with curated notes.
---

# Release Workflow

Follow these steps in order. Stop and report if any step fails.

## Step 1: Guards

Verify all preconditions before proceeding:

1. Run `git status` — working tree must be clean (no uncommitted changes)
2. Verify current branch is `main`
3. Run `git pull --rebase` — must be up to date with origin
4. Run `just check` — lint, typecheck, and all tests must pass
5. Run `just build` — production build must succeed

If any guard fails, stop and explain what failed. Do not proceed.

## Step 2: Determine version

1. Read the current version from `src/dagshund/__init__.py` (the `__version__` line)
2. Show the current version to the user
3. Ask the user: **patch**, **minor**, or **major** bump?
4. Compute the new version string

## Step 3: Bump version

Update the version in all 4 locations (3 files):

1. `src/dagshund/__init__.py` — the `__version__ = "X.Y.Z"` line
2. `.claude-plugin/marketplace.json` — both the root `"version"` field AND `plugins[0].version`
3. `plugins/dagshund/.claude-plugin/plugin.json` — the `"version"` field

## Step 4: Commit version bump

1. Stage the 3 modified files
2. Verify with `git status`
3. Commit with message: `chore: bump version to X.Y.Z`

## Step 5: Draft tag message

1. Get commits since last tag: `git log $(git describe --tags --abbrev=0)..HEAD --oneline`
2. Draft a **short flat bullet list** of key changes — no section headers, just bullets
3. Match the style of existing tags (e.g. v0.6.0 has 4 concise bullets)
4. Present the draft to the user for approval or editing
5. Wait for user approval before proceeding

## Step 6: Create annotated tag

1. Create tag: `git tag -a vX.Y.Z -m "<approved tag message>"`
2. Tag must use `v` prefix + semver format

## Step 7: Push

1. `git push && git push --tags`

## Step 8: Draft GitLab release notes

1. Expand the tag message into the full release notes format
2. Use these sections (skip a section if it has no entries):

```
## What's New
- Feature descriptions (human-readable, not raw commit messages)

## Improvements
- Fixes, refactors, dependency updates, chores
```

3. Present the draft to the user for approval or editing
4. Wait for user approval before proceeding

## Step 9: Create GitLab release

1. `glab release create vX.Y.Z --notes "<approved release notes>"`

## Step 10: Done

Report to the user:
- Version bumped from OLD to NEW
- Tag `vX.Y.Z` created and pushed
- GitLab release published
- Remind: CI will run version-check, build, smoke tests, then manual publish-test and publish jobs are available for PyPI
