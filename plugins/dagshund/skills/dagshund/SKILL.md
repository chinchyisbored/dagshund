---
name: dagshund
description: >
  TRIGGER when: user asks about DAB deployment, bundle plan, what will change
  in a deploy, databricks bundle changes, pending deployments, deployment diff,
  schemas/jobs/resources being deployed, or wants to visualize a bundle plan.
  Visualizes Declarative Automation Bundle (formerly Databricks Asset Bundle)
  deployment plans as colored terminal diffs and interactive DAG diagrams.
---

# Dagshund

## Step 1: Prerequisites

Verify both tools are available before proceeding:

1. `which databricks` — if missing, tell the user to install the Databricks
   CLI first and stop here.
2. Check for dagshund. Choose the first match:
   - `which uvx` succeeds → use `uvx dagshund` (ephemeral, no permanent install)
   - `which pipx` succeeds → use `pipx run dagshund`
   - `which pip` succeeds → `pip install dagshund`
   - None available or Python <3.12 → tell the user dagshund requires
     Python >=3.12 and a Python package runner.

## Step 2: Find deployment targets

Collect ALL targets from ALL config files before making any decision.
These are small YAML files — read them directly, do not delegate to a
subagent.

1. Read `databricks.yml` (or `databricks.yaml`).
2. Read EVERY file listed in the `include:` block. Each one may define
   its own `targets:` key.
3. Merge all discovered targets into a single list. Targets with the same
   name across files are the same target.
4. Only after reading ALL files, apply the selection logic below.

**Choosing a target and confirming intent:**

NEVER run `databricks bundle plan` without explicit user approval. It hits
a live API and takes time. Always ask first — combine the target and the
intent into one question so the user only confirms once.

- If only one target exists or one has `default: true`, propose it:
  *"Want me to run a plan against `dev` to show what would change?"*
- If multiple targets exist and none is default, ask which one:
  *"I see targets `dev`, `staging`, and `prod`. Which one should I plan against?"*
- Once a target is known, remember it for the rest of the session.
  Do not ask again unless the user brings up a different target.

**Security rules — strictly enforced:**

- NEVER read `~/.databrickscfg` — it contains credentials and tokens.
- NEVER read or inspect environment variables for auth tokens.
- NEVER attempt to configure or debug authentication.
- Authentication is handled entirely by the Databricks CLI. If auth fails,
  tell the user to fix their Databricks CLI auth setup. Do not investigate.

## Step 3: Run dagshund

`databricks bundle plan` talks to the Databricks API and may take 30+
seconds. Choose the right workflow based on what the user is asking.
For ambiguous requests, default to text mode.

### Quick text summary (default)

```bash
databricks bundle plan -t <target> -o json | dagshund
```

### Interactive DAG visualization

```bash
databricks bundle plan -t <target> -o json | dagshund -o plan.html -b
```

Suggest this when the user explicitly asks for visualization, the plan has
many resources, or they want to explore job task dependencies. In headless
environments (SSH, CI), omit `-b` and tell the user where the HTML file
was written.

### Filtered views

```bash
databricks bundle plan -t <target> -o json | dagshund -c          # changes only
databricks bundle plan -t <target> -o json | dagshund -a          # added only
databricks bundle plan -t <target> -o json | dagshund -m          # modified only
databricks bundle plan -t <target> -o json | dagshund -r          # removed only
databricks bundle plan -t <target> -o json | dagshund -c -f 'type:jobs'
databricks bundle plan -t <target> -o json | dagshund -f '"exact_name"'
```

### Save plan for later

```bash
databricks bundle plan -t <target> -o json > plan.json
dagshund plan.json
dagshund plan.json -o report.html -b
```

### CI / automation

```bash
databricks bundle plan -t <target> -o json | dagshund -e
# Exit 0 = no changes, 2 = changes detected, 1 = error
```

## Interpreting the output

Text mode groups resources by type (jobs, schemas, volumes, etc.):
- `+` green = will be created
- `-` red = will be deleted
- `~` yellow = will be modified (field-level old → new values shown)
- Dim = unchanged (hidden with `-c`)

Summary line shows totals. A warnings section appears when dangerous actions
affect stateful resources (catalogs, schemas, volumes, registered_models).
Surface these warnings prominently — they indicate potential data loss.

Plan output may contain internal infrastructure details (workspace URLs,
resource names). Do not share or summarize it externally without the
user's awareness.

## When things go wrong

**`databricks bundle plan` fails:** Databricks CLI issue, not dagshund.
Tell the user to check their CLI installation, auth, and target config.

**dagshund exits with an error:** Plan JSON may be malformed or from an
unsupported version. Add `-d` for debug: `dagshund -d plan.json`.

**No changes shown but user expects changes:** The plan itself may report
all resources as unchanged. Run without `-c` to see the full list.
