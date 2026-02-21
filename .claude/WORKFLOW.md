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

## Completing Work

When code is working, follow this exact order. No skipping steps.

1. `just check` — lint + typecheck + all tests
2. `just build` — verify production build
3. **Browser verification** — `just dev` and check in the browser (`just dev-down` to stop). `just build` and `just dev` use different Bun code paths; a passing build doesn't guarantee a working app.
4. **3-pass review** (see below) — fix issues until all passes are clean
5. **Present to human** — what was built, decisions made, issues filed. Get approval.
6. `git add <specific files>` — stage changes (NEVER combine with commit)
7. `source .venv/bin/activate && git commit -m "..."`
8. `bd close <id>` — only AFTER code is committed
9. `git push`

**The git commit IS the deliverable.** Uncommitted work = unfinished work.

## Review Process (3 Passes)

Run before presenting completed work. Use `model: "opus"` for review subagents.
Check beads (especially closed issues) for won't-fix decisions before acting on review findings.

### Pass 1: Functional Correctness
- Does the code do what the issue described?
- Edge cases handled? Data flow end-to-end? Errors explicit?
- Would this break existing functionality?

### Pass 2: Code Philosophy Alignment
Review against CLAUDE.md: immutability, no classes, small composable functions, no `any`, no global state, descriptive names, explicit code.

### Pass 3: Quality & Polish
- TODO comments → should be `bd` issues?
- Dead code, unused imports, stray `console.log`?
- Error boundaries at meaningful levels? Zod at right boundaries?
- Understandable without explanation?

Fix issues per pass before moving to the next. Re-run each pass until clean.

## Session Close

After all work is complete:

1. File issues for any loose threads discussed but not implemented
2. Commit all code (see Completing Work above)
3. Close all finished beads
4. `bd sync` — exports JSONL, stages it (does NOT commit)
5. `git commit` — commit the staged JSONL (pre-commit hook re-exports)
6. `git push`
7. `git status` — must show clean tree, up to date with origin
8. Hand off — session summary: what got done, what's open, suggested next starting point

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
