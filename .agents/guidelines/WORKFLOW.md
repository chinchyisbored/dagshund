# Workflow

## Task Tracking

All tracking of work to do uses `br` (beads_rust). Do NOT use markdown files for plans, TODOs, or task lists.

**Note:** `br` is non-invasive and never executes git commands. `.beads/` changes are rolled into the next feature commit (see Git Rules), never committed by `br` itself.

## Session Start

1. **Wait for the human to choose a br to work on.** Do not auto-pick.

## During Work

- Discover a bug or task → file it: `nix develop --command br create "short title" -t bug -p <priority>`, then `nix develop --command br update <id> --description "..."` for details. Titles are short labels — context, examples, and rationale go in the description.
- Link to current task: `nix develop --command br dep add <new-id> <current-id> --type discovered-from`
- Mark when starting: `nix develop --command br update <id> --status in_progress`
- Create subtasks with dependencies if work grows
- Keep the human informed — mention what you're filing, don't silently create issues

## Dev Commands

**Run every command inside the Nix development shell.** For one-off commands,
use `nix develop --command`. For pipelines, redirection, activation, command
substitution, or multiple commands, use `nix develop --command bash -c
'<commands>'`. Never rely on the host environment.

**Always use `just` commands.** Never call `pytest`, `ruff`, `biome`, or `tsc` directly.
Never manually edit code to fix lint/format issues — let the tools do it.


### Full quality gate
```bash
nix develop --command just check             # lint + typecheck + test (run before completing work)
nix develop --command just build             # JS template + Python wheel
```

## Completing Work

For implementation work, follow this exact order without skipping steps. Release orchestration follows the [release skill](../skills/release/SKILL.md) instead.

1. `nix develop --command just check` — lint + typecheck + all tests
2. `nix develop --command just build` — verify production build
3. **Browser verification** — ask the human to run `nix develop --command just dev`, check the browser, and stop it with `nix develop --command just dev-down`. Build and dev use different Bun code paths; a passing build doesn't guarantee a working app.
4. **3-pass review** (see below) — present findings to human for decision
5. Fix what the human approves and file approved follow-up beads.
6. **Pause for explicit approval before closing the selected bead, committing, or pushing.** Present the diff summary, review outcome, verification, and intended bead closure. Wait for a clear go-ahead that names the approved actions; context, acknowledgement, or a follow-up question is not approval.
7. If the work is tracked by a bead, close it with the approved reason: `nix develop --command br close <id> --reason "<reason>"`.
8. Run `nix develop --command br sync --flush-only` after the final bead mutation.
9. `nix develop --command git add <specific files>` — stage the implementation and `.beads/`, then verify with `nix develop --command git status`.
10. `nix develop --command bash -c 'source .venv/bin/activate && git commit -m "..."'`
11. `nix develop --command git push -u origin <feature-branch>` — push the feature branch.
12. Open the MR non-interactively:
    ```bash
    nix develop --command glab mr create \
      --source-branch <feature-branch> \
      --target-branch main \
      --remove-source-branch \
      --squash-before-merge \
      --title "<title>" \
      --description "<summary and verification>" \
      --yes
    ```
13. Verify the MR title is a conventional commit subject (for example `chore(agents): make skill layout neutral`). GitLab uses the MR title as the squash commit subject on `main`.
14. Wait for the human to merge. Do not poll anything. The closed bead lands on `main` with the implementation; reopen it on the feature branch if the MR is abandoned or work resumes.

**`main` is MR-only and history is linear.** Never push directly to `main`. Every feature branch lands via `nix develop --command glab mr create` followed by human squash merge.

### Git Rules

- NEVER combine `nix develop --command git add` and `nix develop --command git commit` — stage first, verify, then commit
- NEVER run `nix develop --command git reset HEAD` or `nix develop --command git checkout --` on working files
- Activate venv before committing: `nix develop --command bash -c 'source .venv/bin/activate && git commit ...'`
- Run `nix develop --command br sync --flush-only` after the final bead mutation and before staging `.beads/`; it exports the current issue state but does not commit or stage files
- **Beads ride feature commits** (interim practice): after `br` updates, leave `.beads/` dirty and stage it together with the next feature-branch commit. No standalone `chore(beads): sync` commits, no separate sync branches. If a session ends with beads-only changes, leave `.beads/` dirty for the next session.

## Review Process

Run before presenting completed work. This is a **read-and-reason** exercise — do NOT write or run scripts to check code.

### Step 1: Determine scope

Find all files changed on this branch plus any uncommitted work:

```bash
# Changed files on branch (not yet pushed)
nix develop --command git diff origin/main...HEAD --name-only
# Uncommitted changes (staged + unstaged)
nix develop --command git diff HEAD --name-only
```

Combine and deduplicate into a single file list.

### Step 2: Spawn a single review subagent

Start exactly one managed subagent with `profile: reviewer`. Do not use a scout or generic exploration profile, and do not pin a model. Give the reviewer a self-contained assignment containing:

- **Objective:** independently review the completed implementation against the selected bead, its acceptance criteria, and all three review passes below
- **Scope:** the exact file list from Step 1 plus the relevant bead or specification context; include `AGENTS.md` and the applicable language guideline files as review context, not as changed implementation scope
- **Exclusions:** no edits, fixes, new scripts, or review outside the stated scope
- **Expected output:** prioritized findings grouped by pass, each with severity, file and line evidence, rationale, and a suggested disposition; include verification performed and state explicitly when there are no findings
- **Stop condition:** stop after every scoped file and review criterion has been evaluated once

Retrieve the completed review with `get_subagent_result`. Do not start additional reviewers for the same implementation.

**Pass 1 — Functional Correctness:**
- Does the code do what the issue described?
- Edge cases handled? Data flow end-to-end? Errors explicit?
- Would this break existing functionality?

**Pass 2 — Code Philosophy Alignment:**
- Review against AGENTS.md rules: immutability, no classes, small composable functions, no `any`, no global state, descriptive names, explicit code

**Pass 3 — Quality & Polish:**
- TODO comments that should be `br` issues?
- Dead code, unused imports, stray `console.log`?
- Error boundaries at meaningful levels? Zod at right boundaries?
- Understandable without explanation?

### Step 3: Present findings to human

Present findings organized by pass. For each finding, suggest one of:
- **Fix** — should be addressed now
- **Bead** — file as an issue for later
- **Skip** — already a won't-fix or not worth changing

**Do not fix or file anything until the human approves.** Beads are only created after the human says so.

## Session Close

Before ending a session:

1. Ensure approved follow-up work has been filed as beads and mention any proposed follow-ups still awaiting human approval.
2. If the implementation is ready for delivery, follow [Completing Work](#completing-work). If approval or merge is pending, stop and report that state.
3. After any bead mutation not already included in the feature commit, run `nix develop --command br sync --flush-only`. Do not create a standalone beads commit; beads-only changes remain dirty for the next feature commit.
4. Run `nix develop --command git status` and report the branch, MR state, and any uncommitted files. Do not pull, rebase, or push solely to make the session clean.
5. Hand off with what was completed, what remains open, and the suggested next starting point.
