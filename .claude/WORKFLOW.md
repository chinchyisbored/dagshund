# Workflow

## Task Tracking

All tracking uses `bd` (Beads). Do NOT use markdown files for plans, TODOs, or task lists.
Run `bd onboard` at the start of a new engagement with the project.

## Session Start

1. `bd ready --json` — see what's unblocked
2. `bd list --status in_progress --json` — see anything mid-flight
3. Present summary: what's ready, what's in progress, what you recommend
4. **Wait for the human to choose.** Do not auto-pick.

## During Work

- Discover a bug or task → file it: `bd create "description" -t bug -p <priority>`
- Link to current task: `bd dep add <new-id> <current-id> --type discovered-from`
- Mark when starting: `bd update <id> --status in_progress`
- Create subtasks with dependencies if work grows
- Keep the human informed — mention what you're filing, don't silently create issues

## Dev Commands

**Always use `just` commands.** Never call `pytest`, `ruff`, `biome`, or `tsc` directly.
Never manually edit code to fix lint/format issues — let the tools do it.

### Testing
```bash
just test              # All tests (JS + Python)
just test-py           # All Python tests with coverage
just test-py "filter"  # Single Python test (-k expression or file::test)
just test-js           # All JS tests with coverage
just test-js "filter"  # Single JS test (name pattern)
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

### Full quality gate
```bash
just check             # lint + typecheck + test (run before completing work)
just build             # JS template + Python wheel
```

## Completing Work

When code is working, follow this exact order. No skipping steps.

1. `just check` — lint + typecheck + all tests
2. `just build` — verify production build
3. **Browser verification** — `just dev` and check in the browser (`just dev-down` to stop). `just build` and `just dev` use different Bun code paths; a passing build doesn't guarantee a working app.
4. **3-pass review** (see below) — present findings to human for decision
5. Fix what human approves, file beads for the rest
6. `git add <specific files>` — stage changes (NEVER combine with commit)
7. `source .venv/bin/activate && git commit -m "..."`
8. `bd close <id>` — only AFTER code is committed
9. `git push`

**The git commit IS the deliverable.** Uncommitted work = unfinished work.

## Review Process (3 Parallel Passes)

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

### Step 2: Spawn 3 review subagents in parallel

Use `model: "opus"` and `subagent_type: "Explore"`. Each subagent receives:
- The file list from Step 1
- Its specific review criteria (below)
- Instruction to read the changed files, reason about them, and report findings as plain text
- Instruction to check closed beads (`bd list --status=closed`) for won't-fix decisions — do not flag things already decided

Each subagent reads the code and returns a list of findings. No fixes, no scripts, just observations.

**Pass 1 — Functional Correctness:**
- Does the code do what the issue described?
- Edge cases handled? Data flow end-to-end? Errors explicit?
- Would this break existing functionality?

**Pass 2 — Code Philosophy Alignment:**
- Review against CLAUDE.md rules: immutability, no classes, small composable functions, no `any`, no global state, descriptive names, explicit code

**Pass 3 — Quality & Polish:**
- TODO comments that should be `bd` issues?
- Dead code, unused imports, stray `console.log`?
- Error boundaries at meaningful levels? Zod at right boundaries?
- Understandable without explanation?

### Step 3: Present findings to human

Collect all 3 reports. Present a unified summary to the human, organized by pass. For each finding, suggest one of:
- **Fix** — should be addressed now
- **Bead** — file as an issue for later
- **Skip** — already a won't-fix or not worth changing

**Wait for the human to decide.** Do not fix anything until the human approves.

## Session Close

After all work is complete:

1. File issues for any loose threads discussed but not implemented
2. Commit all code (see Completing Work above)
3. Close all finished beads
4. `bd sync` — exports JSONL, stages it (does NOT commit)
5. `git commit` — commit the staged JSONL (pre-commit hook re-exports)
6. `git pull --rebase` — catch up with remote before pushing
7. `git push`
8. `git status` — must show clean tree, up to date with origin
9. Hand off — session summary: what got done, what's open, suggested next starting point

## Beads & Git Rules

- `bd sync` stages JSONL but does NOT commit. Always: `bd sync` → `git commit` → `git push`
- NEVER run `bd sync` before committing source code — it modifies git index, unstages your files
- NEVER manually `git add .beads/issues.jsonl` — pre-commit hook handles it
- NEVER combine `git add` and `git commit` — stage first, verify with `git status`, then commit
- NEVER run `git reset HEAD` or `git checkout --` on working files
- NEVER run `bun run lint:fix` without reviewing scope — use `just lint` (check-only)
- Beads-only commits (no source changes): `git commit --allow-empty`
- Activate venv before committing: `source .venv/bin/activate && git commit ...`
- Beads daemon is disabled — pre-commit hook handles JSONL export

## Priority

- **P0**: Blocks everything, fix immediately
- **P1**: Core functionality, do soon
- **P2**: Important but not urgent (default)
- **P3**: Nice to have, backlog
- **P4**: Wishlist

## Collaboration

- Always wait for human input before choosing work
- Always run 3-pass review before presenting work
- Never silently skip filing an issue — if worth noting, worth tracking
- Keep the human in the loop — this is a partnership, not delegation
- Don't plan when you should be doing — if next steps are known, just do them
- Work is NOT complete until `git push` succeeds. Never say "ready to push when you are" — push it yourself.
