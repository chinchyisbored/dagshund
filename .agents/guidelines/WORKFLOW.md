# Workflow

## Task Tracking

All tracking of work to do uses `br` (beads_rust). Do NOT use markdown files for plans, TODOs, or task lists.

**Note:** `br` is non-invasive and never executes git commands. `.beads/` changes are rolled into the next feature commit (see Git Rules), never committed by `br` itself.

## Session Start

1. `br ready --json` — see what's unblocked
2. `br list --status in_progress --json` — see anything mid-flight
3. Present summary: what's ready, what's in progress, what you recommend
4. **Wait for the human to choose.** Do not auto-pick.

## During Work

- Discover a bug or task → file it: `br create "short title" -t bug -p <priority>`, then `br update <id> --description "..."` for details. Titles are short labels — context, examples, and rationale go in the description.
- Link to current task: `br dep add <new-id> <current-id> --type discovered-from`
- Mark when starting: `br update <id> --status in_progress`
- Create subtasks with dependencies if work grows
- Keep the human informed — mention what you're filing, don't silently create issues

## Dev Commands

**Always use `just` commands.** Never call `pytest`, `ruff`, `biome`, or `tsc` directly.
Never manually edit code to fix lint/format issues — let the tools do it.

**Sandboxed agents:** if a required workflow command is known to write outside
the workspace (for example `uv` cache, Just runtime state, Git refs, or dev
server runtime files), request the needed approval before running it. Do not
run a command only to hit a predictable sandbox failure and then retry.

### Testing
```bash
just test              # All tests (JS + Python)
just test-py           # All Python tests with coverage
just test-js           # All JS tests with coverage
```

### Fixing lint & format issues
```bash
just lint              # Lint all (applies safe fixes automatically)
just lint-py           # Ruff check --fix
just lint-js           # Biome check --fix
just format            # Format all
just format-py         # Ruff format
just format-js         # Biome format
```

### Typechecking
```bash
just typecheck         # All typecheckers
just typecheck-py      # ty
just typecheck-js      # tsc
```

### Code Intelligence

Prefer LSP over Grep/Read for code navigation — it's faster, precise, and avoids reading entire files:
- `workspaceSymbol` to find where something is defined
- `findReferences` to see all usages across the codebase
- `goToDefinition` / `goToImplementation` to jump to source
- `hover` for type info without reading the file

Use Grep only when LSP isn't available or for text/pattern searches (comments, strings, config).

After writing or editing code, check LSP diagnostics and fix errors before proceeding.

### Full quality gate
```bash
just check             # lint + typecheck + test (run before completing work)
just build             # JS template + Python wheel
```

## Completing Work

When code is working, follow this exact order. No skipping steps.

1. `just check` — lint + typecheck + all tests
2. `just build` — verify production build
3. **Browser verification** — ask the human to run `just dev`, check the browser, and stop it with `just dev-down`. `just build` and `just dev` use different Bun code paths; a passing build doesn't guarantee a working app.
4. **3-pass review** (see below) — present findings to human for decision
5. Fix what human approves, file beads for the rest
6. **Pause for explicit approval before committing or pushing.** Present the diff summary and wait for a clear go-ahead ("yes", "commit", "push"). Context, acknowledgement, or a follow-up question is NOT approval.
7. `git add <specific files>` — stage changes, verify with `git status`
8. `source .venv/bin/activate && git commit -m "..."`
9. `git push -u origin <feature-branch>` — push the feature branch
10. Open the MR non-interactively:
   ```bash
   glab mr create \
     --source-branch <feature-branch> \
     --target-branch main \
     --remove-source-branch \
     --squash-before-merge \
     --title "<title>" \
     --description "<summary and verification>" \
     --yes
   ```
11. Before merging, verify the MR title is a conventional commit subject
    (for example `chore(agents): make skill layout neutral`). GitLab uses the
    MR title as the squash commit subject on `main`.
12. Wait for the MR pipeline to go green, then squash-merge with explicit user approval: `glab mr merge <iid> --squash --yes`
13. `git checkout main && git pull --ff-only origin main`
14. `br close <id>` — only AFTER the MR is merged, main is up to date, AND the user has explicitly approved closing. Never close a bead on your own judgment.

**`main` is MR-only and history is linear.** Never push directly to `main`. Every feature branch lands via `glab mr create` followed by `glab mr merge --squash` — always squash, never a merge commit. The git commit IS the deliverable; the squash-merge IS the handoff.

### Git Rules

- NEVER combine `git add` and `git commit` — stage first, verify, then commit
- NEVER run `git reset HEAD` or `git checkout --` on working files
- Activate venv before committing: `source .venv/bin/activate && git commit ...`
- `br sync --flush-only` is the final JSONL export and merge-base snapshot check before staging `.beads/`; it does NOT commit or stage
- **Beads ride feature commits** (interim practice): after `br` updates, leave `.beads/` dirty and stage it together with the next feature-branch commit. No standalone `chore(beads): sync` commits, no separate sync branches. If a session ends with beads-only changes, leave `.beads/` dirty for the next session.

## Review Process

Run before presenting completed work. This is a **read-and-reason** exercise — do NOT write or run scripts to check code.

### Step 1: Determine scope

Find all files changed on this branch plus any uncommitted work:

```bash
# Changed files on branch (not yet pushed)
git diff origin/main...HEAD --name-only
# Uncommitted changes (staged + unstaged)
git diff HEAD --name-only
```

Combine and deduplicate into a single file list.

### Step 2: Spawn a single review subagent

Use a single review/exploration subagent with the strongest available reasoning model.
For Claude Code, use `subagent_type: "Explore"` and do not pin a model name — leave
`model` unset to inherit the session's model, or pick the strongest currently available.
For Codex, use the available explorer/review subagent and do not request unsupported
model or agent-type names. The subagent receives:
- The file list from Step 1
- All three review criteria below
- Instruction to read the changed files once, then evaluate against all criteria
- Instruction to check closed beads (`br list --status=closed`) for won't-fix decisions — do not flag things already decided

One agent reads the files once and runs all 3 passes over the same context. No fixes, no scripts, just observations.

**Devil's advocate check — required before filing any finding:**

Before proposing a change, the reviewer must argue *against* their own finding:
- "Why might the current code be intentionally written this way?"
- For "consistency" findings: is the inconsistency intentional because the cases are semantically different?
- For "simplification" findings: does the current approach handle edge cases (concurrent mode, timing, error recovery) that the simpler version wouldn't?
- For "missing pattern" findings: does the context actually benefit from the pattern, or is it cargo-culting from a different context?

Include the devil's advocate argument with every finding. The human decides whether it holds — the reviewer does not filter.

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

Present findings organized by pass. Each finding includes its devil's advocate counter-argument. For each finding, suggest one of:
- **Fix** — should be addressed now
- **Bead** — file as an issue for later
- **Skip** — already a won't-fix or not worth changing

**Do not fix or file anything until the human approves.** Beads are only created after the human says so.

## Session Close

After all work is complete:

1. File issues for any loose threads discussed but not implemented
2. Commit all code (follow Completing Work above, including the approval pause)
3. Close finished beads — only those the user has explicitly approved closing
4. Run `br sync --flush-only`; `.beads/` changes ride the feature commit (see Git Rules). Beads-only leftovers stay dirty for the next session.
5. With explicit approval: `git pull --rebase` then `git push`
6. `git status` — clean tree (a dirty `.beads/` from step 4 is the allowed exception), up to date with origin
7. Hand off — session summary: what got done, what's open, suggested next starting point

## Collaboration

- Always wait for human input before choosing work
- Always run 3-pass review before presenting work
- Never silently skip filing an issue — if worth noting, worth tracking
- Keep the human in the loop — this is a partnership, not delegation
- Don't plan when you should be doing — if next steps are known, just do them
- Committing, pushing, merging, and closing beads each require an explicit user go-ahead. Present the work, ask once, and wait — context or acknowledgement in the reply is not approval.
