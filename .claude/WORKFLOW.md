# Workflow

## Task Tracking

All tracking uses `br` (beads_rust). Do NOT use markdown files for plans, TODOs, or task lists.

**Note:** `br` is non-invasive and never executes git commands. After `br sync --flush-only`, you must manually run `git add .beads/ && git commit`.

Run `br onboard` at the start of a new engagement with the project.

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
8. `br close <id>` — only AFTER code is committed
9. `git push`

**The git commit IS the deliverable.** Uncommitted work = unfinished work.

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

Use `model: "opus"` and `subagent_type: "Explore"`. The subagent receives:
- The file list from Step 1
- All three review criteria below
- Instruction to read the changed files once, then evaluate against all criteria
- Instruction to check closed beads (`br list --status=closed`) for won't-fix decisions — do not flag things already decided

One agent reads the files once and runs all 3 passes over the same context. No fixes, no scripts, just observations.

**Pass 1 — Functional Correctness:**
- Does the code do what the issue described?
- Edge cases handled? Data flow end-to-end? Errors explicit?
- Would this break existing functionality?

**Pass 2 — Code Philosophy Alignment:**
- Review against CLAUDE.md rules: immutability, no classes, small composable functions, no `any`, no global state, descriptive names, explicit code

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

**Wait for the human to decide.** Do not fix anything until the human approves.

## Session Close

After all work is complete:

1. File issues for any loose threads discussed but not implemented
2. Commit all code (see Completing Work above)
3. Close all finished beads
4. Sync and commit beads:
   ```bash
   br sync --flush-only
   git add .beads/
   git commit -m "sync beads"
   ```
5. `git pull --rebase` — catch up with remote before pushing
6. `git push`
7. `git status` — must show clean tree, up to date with origin
8. Hand off — session summary: what got done, what's open, suggested next starting point

## Beads & Git Rules

- `br sync --flush-only` exports JSONL but does NOT commit or stage. Always: `br sync --flush-only` → `git add .beads/` → `git commit` → `git push`
- NEVER run `br sync --flush-only` before committing source code — commit source first, then sync beads
- NEVER combine `git add` and `git commit` — stage first, verify with `git status`, then commit
- NEVER run `git reset HEAD` or `git checkout --` on working files
- NEVER run `bun run lint:fix` without reviewing scope — use `just lint` (check-only)
- Beads-only commits (no source changes): `br sync --flush-only && git add .beads/ && git commit -m "sync beads"`
- Activate venv before committing: `source .venv/bin/activate && git commit ...`

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
