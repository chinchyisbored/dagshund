---
name: release
description: >
  Automated release workflow for dagshund. Branches, bumps version, opens an MR for human squash merge, tags the merged commit, pushes, and creates GitLab and GitHub releases with curated notes.
---

# Release Workflow

Follow these steps in order. Stop and report if any step fails. `main` is
MR-only and linear — never commit or push to it directly. Run every command
through `nix develop --command`; use `nix develop --command bash -c` when a
step needs shell syntax. Never use tools inherited from the host environment.

## Step 1: Guards

Verify all preconditions before proceeding:

1. Run `nix develop --command git status` — working tree must be clean (no uncommitted changes)
2. Verify current branch is `main` with `nix develop --command git branch --show-current`
3. Run `nix develop --command git pull --ff-only` — must be up to date with origin
4. Run `nix develop --command just check` — lint, typecheck, and all tests must pass
5. Run `nix develop --command just build` — production build must succeed

If any guard fails, stop and explain what failed. Do not proceed.

## Step 2: Determine version

1. Read the current version from `src/dagshund/__init__.py` (the `__version__` line)
2. Show the current version to the user
3. Ask the user: **patch**, **minor**, or **major** bump?
4. Compute the new version string

## Step 3: Create release branch

1. `nix develop --command git checkout -b release/vX.Y.Z`

## Step 4: Bump version

Update the version in 1 location:

1. `src/dagshund/__init__.py` — the `__version__ = "X.Y.Z"` line

## Step 5: Commit version bump

1. `nix develop --command git add src/dagshund/__init__.py`
2. Verify with `nix develop --command git status`
3. Commit with `nix develop --command bash -c 'source .venv/bin/activate && git commit -m "chore: bump version to X.Y.Z"'`

## Step 6: Draft tag message

1. Get commits since last tag: `nix develop --command bash -c 'git log "$(git describe --tags --abbrev=0)"..HEAD --oneline'`
2. Draft a **short flat bullet list** of key changes — no section headers, just bullets
3. Match the style of existing tags (e.g. v0.6.0 has 4 concise bullets)
4. Present the draft to the user for approval or editing
5. Wait for user approval before proceeding

## Step 7: Push release branch

1. `nix develop --command git push -u origin release/vX.Y.Z`

## Step 8: Open merge request

1. `nix develop --command glab mr create --source-branch release/vX.Y.Z --target-branch main --title "chore: release vX.Y.Z" --description "<tag bullets>" --remove-source-branch --squash-before-merge --yes`
2. Capture the MR IID from the output for later state and SHA lookup.
3. Verify the MR title remains the conventional subject `chore: release vX.Y.Z`.

## Step 9: Hand off the merge request

1. Report the MR URL to the user.
2. Stop and wait for the user to handle the pipeline and squash-merge in GitLab.
3. Do not query or track pipeline status, and do not merge the MR, unless the
   user explicitly requests that specific action.

## Step 10: Verify the user completed the squash merge

After the user says the MR is merged, verify its state once:

```bash
nix develop --command bash -c '
state=$(glab mr view <mr-iid> --output json | jq -r '\''.state'\'')
if [ "$state" != "merged" ]; then
  echo "release MR is not merged"
  exit 1
fi
'
```

Do not proceed until this succeeds.

## Step 11: Resolve the squashed merge commit SHA

Ask GitLab for the exact SHA of the squashed commit on main. Do not guess
from git — this is race-proof against concurrent merges.

```bash
nix develop --command bash -c '
set -euo pipefail
release_sha=$(glab mr view <mr-iid> --output json \
  | jq -r '\''.squash_commit_sha'\'')
if [ -z "$release_sha" ] || [ "$release_sha" = "null" ]; then
  echo "could not resolve release commit sha from MR"
  exit 1
fi
printf "%s\n" "$release_sha" > /tmp/dagshund-release-sha
'
```

## Step 12: Switch to main and fast-forward pull

1. `nix develop --command git checkout main`
2. `nix develop --command git pull --ff-only origin main`

If `--ff-only` refuses, bail out and tell the user that main diverged in
an unexpected way. Do not proceed.

## Step 13: Verify the resolved SHA is on main

```bash
nix develop --command bash -c '
git merge-base --is-ancestor "$(cat /tmp/dagshund-release-sha)" origin/main
'
```

Must succeed. If it doesn't, abort — something is wrong with the merge or
the SHA resolution.

## Step 14: Create annotated tag on the resolved SHA

1. `nix develop --command bash -c 'git tag -a "vX.Y.Z" "$(cat /tmp/dagshund-release-sha)" -m "<approved tag message>"'`
2. Tag must use `v` prefix + semver format and point at the exact squashed
   release commit, not `HEAD`.

## Step 15: Push tag

1. `nix develop --command git push origin "vX.Y.Z"`

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
5. Save the approved notes to `/tmp/dagshund-vX.Y.Z-release-notes.md`
   so both GitLab and GitHub receive real Markdown line breaks.

## Step 17: Create GitLab release

1. `nix develop --command glab release create "vX.Y.Z" --notes-file "/tmp/dagshund-vX.Y.Z-release-notes.md"`

## Step 18: Create GitHub mirror release

The GitLab remote mirror syncs Git refs, but it does **not** create GitHub
Release objects. After the GitLab release exists, create the matching GitHub
release in the configured mirror repository.

1. Verify GitHub CLI authentication:

   ```bash
   nix develop --command gh auth status
   ```

   If authentication is missing, stop and ask the user to run the interactive
   `nix develop --command gh auth login`. Never attempt to bypass the prompt.

2. Resolve the enabled GitHub mirror repo and save it for later steps:

   ```bash
   nix develop --command bash -c '
   set -euo pipefail
   project_id=$(glab repo view --output json | jq -r '\''.id'\'')
   mirror_url=$(glab api "projects/${project_id}/remote_mirrors" \
     | jq -r '\''.[] | select(.enabled and (.url | contains("github.com"))) | .url'\'' \
     | head -n1)
   github_repo=$(printf "%s\n" "$mirror_url" \
     | sed -E '\''s#^(ssh://)?git@github.com[:/]##; s#^https://github.com/##; s#\.git$##'\'')
   if [ -z "$github_repo" ]; then
     echo "could not resolve GitHub mirror repo"
     exit 1
   fi
   printf "%s\n" "$project_id" > /tmp/dagshund-gitlab-project-id
   printf "%s\n" "$github_repo" > /tmp/dagshund-github-repo
   '
   ```

3. Verify the mirrored tag exists before creating the release:

   ```bash
   nix develop --command bash -c '
   github_repo=$(cat /tmp/dagshund-github-repo)
   gh api "repos/${github_repo}/git/refs/tags/vX.Y.Z" >/dev/null
   '
   ```

   If the tag is missing, inspect the remote mirror status with
   `nix develop --command bash -c 'project_id=$(cat /tmp/dagshund-gitlab-project-id); glab api "projects/${project_id}/remote_mirrors"'`
   and wait for the mirror to finish. Do not create the tag manually in GitHub.

4. Create the GitHub release from the existing mirrored tag:

   ```bash
   nix develop --command bash -c '
   github_repo=$(cat /tmp/dagshund-github-repo)
   gh release create "vX.Y.Z" \
     --repo "$github_repo" \
     --title "vX.Y.Z" \
     --notes-file "/tmp/dagshund-vX.Y.Z-release-notes.md" \
     --verify-tag \
     --latest
   '
   ```

5. Verify it exists:
   `nix develop --command bash -c 'github_repo=$(cat /tmp/dagshund-github-repo); gh release view "vX.Y.Z" --repo "$github_repo"'`

## Step 19: Done

Report to the user:
- Version bumped from OLD to NEW
- MR squash-merged into main (linear history preserved)
- Tag `vX.Y.Z` created on the squashed commit and pushed
- GitLab release published
- GitHub mirror release published
- Remind: CI will run `version-check`, `build`, `smoke-wheel`, then the
  manual `publish-test` and `publish` jobs are available on the tag
  pipeline for PyPI
