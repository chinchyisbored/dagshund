---
name: release
description: >
  Automated release workflow for dagshund. Branches, bumps version, opens an
  MR to main, squash-merges, tags the merged commit, pushes, and creates a
  GitLab release with curated notes.
---

# Release Workflow

Follow these steps in order. Stop and report if any step fails. `main` is
MR-only and linear — never commit or push to it directly.

## Step 1: Guards

Verify all preconditions before proceeding:

1. Run `git status` — working tree must be clean (no uncommitted changes)
2. Verify current branch is `main`
3. Run `git pull --ff-only` — must be up to date with origin
4. Run `just check` — lint, typecheck, and all tests must pass
5. Run `just build` — production build must succeed

If any guard fails, stop and explain what failed. Do not proceed.

## Step 2: Determine version

1. Read the current version from `src/dagshund/__init__.py` (the `__version__` line)
2. Show the current version to the user
3. Ask the user: **patch**, **minor**, or **major** bump?
4. Compute the new version string

## Step 3: Create release branch

1. `git checkout -b release/vX.Y.Z`

## Step 4: Bump version

Update the version in all 4 locations (3 files):

1. `src/dagshund/__init__.py` — the `__version__ = "X.Y.Z"` line
2. `.claude-plugin/marketplace.json` — both the root `"version"` field AND `plugins[0].version`
3. `plugins/dagshund/.claude-plugin/plugin.json` — the `"version"` field

## Step 5: Commit version bump

1. Stage the 3 modified files
2. Verify with `git status`
3. Commit with message: `chore: bump version to X.Y.Z`

## Step 6: Draft tag message

1. Get commits since last tag: `git log $(git describe --tags --abbrev=0)..HEAD --oneline`
2. Draft a **short flat bullet list** of key changes — no section headers, just bullets
3. Match the style of existing tags (e.g. v0.6.0 has 4 concise bullets)
4. Present the draft to the user for approval or editing
5. Wait for user approval before proceeding

## Step 7: Push release branch

1. `git push -u origin release/vX.Y.Z`

## Step 8: Open merge request

1. `glab mr create --source-branch release/vX.Y.Z --target-branch main --title "chore: release vX.Y.Z" --description "<tag bullets>" --remove-source-branch --squash --yes`
2. Capture the MR IID from the output — needed for merge and SHA lookup

## Step 9: Wait for MR pipeline

1. Wait for the MR pipeline to go green: `quality` + `golden` + `sast` + `secret_detection` + `dependency-scan`
2. Report the pipeline URL to the user
3. If anything fails, stop and fix on the release branch before proceeding

## Step 10: Squash-merge the MR

1. **Get explicit user approval before merging.**
2. `glab mr merge <mr-iid> --squash --yes`
3. Main stays linear — one squashed commit per MR, no merge commits.

## Step 11: Resolve the squashed merge commit SHA

Ask GitLab for the exact SHA of the squashed commit on main. Do not guess
from git — this is race-proof against concurrent merges.

```bash
RELEASE_SHA=$(glab mr view <mr-iid> --output json | jq -r '.merge_commit_sha // .squash_commit_sha')
if [ -z "$RELEASE_SHA" ] || [ "$RELEASE_SHA" = "null" ]; then
  echo "could not resolve release commit sha from MR"
  exit 1
fi
```

## Step 12: Switch to main and fast-forward pull

1. `git checkout main`
2. `git pull --ff-only origin main`

If `--ff-only` refuses, bail out and tell the user that main diverged in
an unexpected way. Do not proceed.

## Step 13: Verify the resolved SHA is on main

```bash
git merge-base --is-ancestor "$RELEASE_SHA" origin/main
```

Must succeed. If it doesn't, abort — something is wrong with the merge or
the SHA resolution.

## Step 14: Create annotated tag on the resolved SHA

1. `git tag -a "v${NEW_VERSION}" "$RELEASE_SHA" -m "<approved tag message>"`
2. Tag must use `v` prefix + semver format and point at the exact squashed
   release commit, not `HEAD`.

## Step 15: Push tag

1. `git push origin "v${NEW_VERSION}"`

This triggers the tag pipeline: `version-check` → `build` → `smoke-wheel` →
manual `publish-test` → manual `publish`.

## Step 16: Draft GitLab release notes

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

## Step 17: Create GitLab release

1. `glab release create "v${NEW_VERSION}" --notes "<approved release notes>"`

## Step 18: Done

Report to the user:
- Version bumped from OLD to NEW
- MR squash-merged into main (linear history preserved)
- Tag `vX.Y.Z` created on the squashed commit and pushed
- GitLab release published
- Remind: CI will run `version-check`, `build`, `smoke-wheel`, then the
  manual `publish-test` and `publish` jobs are available on the tag
  pipeline for PyPI
