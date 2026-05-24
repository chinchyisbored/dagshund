# Agent Workflows

These runbooks are the canonical, agent-neutral workflows for recurring
project operations.

Tool-specific integrations, such as Claude slash commands or Codex skills,
should stay thin and delegate here rather than duplicating the full procedure.

Current adapters:

- Claude slash commands: `.claude/commands/`
- Codex skills: `.codex/skills/`

## Adapter Contract

Adapters may add short trigger and exclusion language so host tools route to the
right workflow. They must not duplicate step-by-step instructions from the
runbooks.

Repo-owned routing metadata or routing fixtures are intentionally deferred. The
current workflows are narrow, and host integrations already route through
command or skill names plus their descriptions. Add repo-owned routing only if
there is evidence of repeated accidental triggering that the adapter
descriptions cannot fix.

Deterministic helper scripts are also deferred for now. The high-risk workflow
steps already include exact commands for release SHA resolution, MR state,
Databricks CLI release verification, fixture drift comparison, and manual-drift
sanity checks. Add a `just` command or small script only when the prose workflow
causes real command drift or safety risk.
