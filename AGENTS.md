# AGENTS.md — Workflow Instructions

BEFORE ANYTHING ELSE: run `bd onboard` and follow the instructions.

## Core Workflow

This project uses `bd` (Beads) for all task and issue tracking. Do NOT use markdown files
for plans, TODOs, or task lists. Everything goes through `bd`.

## Session Start Protocol

1. Run `bd ready --json` to see what's unblocked
2. Run `bd list --status in_progress --json` to see anything mid-flight
3. Present a summary to the human: what's ready, what's in progress, what you recommend
4. **Wait for the human to choose** what to work on. Do not auto-pick.

## During Work

- When you discover a bug or future task, file it: `bd create "description" -t bug -p <priority>`
- Link discovered work to current task: `bd dep add <new-id> <current-id> --type discovered-from`
- Update status when starting: `bd update <id> --status in_progress`
- If a task turns out to need subtasks, create them with parent-child dependencies
- Keep the human informed of what you're filing — mention it conversationally, don't just silently create issues

## Completing Work

When you believe a task is complete, do NOT present it to the human yet. First, run the review process.

## Review Process (3 Passes)

After completing implementation of any task, run three review passes before presenting work.
Each pass has a specific focus. Address all findings before moving to the next pass.

### Pass 1: Functional Correctness
Review the changes and ask yourself:
- Does the code actually do what the task/issue described?
- Are there edge cases that aren't handled?
- Does the data flow make sense end to end?
- Are errors handled explicitly (not swallowed)?
- Would this break any existing functionality?

If issues are found: fix them, then re-run pass 1 until clean.

### Pass 2: Code Philosophy Alignment
Review against CLAUDE.md coding philosophy:
- **Immutability**: Are all data structures treated as immutable? Any mutations?
- **Functions over classes**: Any classes snuck in? Any OOP patterns?
- **Composition**: Are functions small and composable? Anything over 20 lines?
- **No global state**: Any module-level `let` or mutable state outside React?
- **Types**: Any `any` types? Any type assertions without justification?
- **Naming**: Do names follow conventions? Are they descriptive?
- **Explicitness**: Is the code readable without clever tricks?

If issues are found: fix them, then re-run pass 2 until clean.

### Pass 3: Quality & Polish
- Are there any TODO comments that should be `bd` issues instead?
- Is there dead code or unused imports?
- Are there any console.log statements that should be removed?
- Do components have appropriate error boundaries?
- Are Zod schemas validating at the right boundaries?
- Would a new developer understand this code without explanation?

If issues are found: fix them, then re-run pass 3 until clean.

### After Review
When all 3 passes are clean:
1. `bd close <id> --reason "description of what was implemented"`
2. Present the work to the human with a brief summary of:
   - What was implemented
   - Any interesting decisions made
   - Any new issues filed during the work
   - What's recommended next (from `bd ready`)

## Task Priority Guide

- **P0**: Blocks everything, fix immediately (broken build, data loss risk)
- **P1**: Core functionality, should be done soon
- **P2**: Important but not urgent (default for new work)
- **P3**: Nice to have, backlog material
- **P4**: Wishlist, maybe someday

## Session End Protocol

1. Make sure all in-progress work is either completed or has status updated
2. File issues for any loose threads or ideas discussed but not implemented
3. Run `bd sync` to flush the database
4. Commit and push all changes including `.beads/`
5. Present a session summary:
   - What got done
   - What's still open
   - Suggested next session starting point

## Important Rules

- **Always wait for human input** before choosing work at session start
- **Always run the 3-pass review** before presenting completed work
- **Never silently skip filing an issue** for something you notice — if it's worth noting, it's worth tracking
- **Keep the human in the loop** — mention what you're doing, what you're filing, what you're finding
- The human enjoys collaborating and steering the code. This is a partnership, not delegation.

## Landing the Plane (Session Completion)

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed):
   ```bash
   bun run lint       # Biome lint check
   bun run test       # Run tests
   bunx tsc --noEmit  # Type-check
   bun run build      # Verify production build
   ```
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   bd sync
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds
