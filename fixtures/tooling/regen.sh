#!/usr/bin/env bash
# Regenerate golden fixture(s) from a real Databricks workspace.
#
# Usage:
#   fixtures/tooling/regen.sh <fixture-name>   — regenerate one fixture
#   fixtures/tooling/regen.sh --all            — regenerate all fixtures
#
# Requires: authenticated Databricks CLI >= 0.296.0, engine=direct.
# Local-only — never runs in CI.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
GOLDEN_DIR="$SCRIPT_DIR/../golden"

# Source .env for BUNDLE_VAR_* overrides (gitignored, contains PII like emails).
if [[ -f "$GOLDEN_DIR/.env" ]]; then
  set -a
  # shellcheck source=/dev/null
  source "$GOLDEN_DIR/.env"
  set +a
fi

regen_one() (
  # Runs in a subshell so cd does not affect the caller.
  local name="$1"
  local fixture_dir="$GOLDEN_DIR/$name"

  if [[ ! -d "$fixture_dir/before" ]]; then
    echo "Error: no before/ dir in $fixture_dir" >&2
    exit 1
  fi
  if [[ ! -d "$fixture_dir/after" ]]; then
    echo "Error: no after/ dir in $fixture_dir" >&2
    exit 1
  fi

  # Remove local state from previous runs to avoid stale references.
  rm -rf "$fixture_dir/before/.databricks" "$fixture_dir/after/.databricks"

  # Ensure we always attempt destroy, even on failure.
  # shellcheck disable=SC2329
  cleanup() {
    echo "==> [$name] Cleanup: destroying deployed state..." >&2
    cd "$fixture_dir/after" && databricks bundle destroy --auto-approve || true
  }
  trap cleanup EXIT

  echo "==> [$name] Deploying before/ state..."
  cd "$fixture_dir/before"
  databricks bundle deploy

  echo "==> [$name] Planning after/ state..."
  cd "$fixture_dir/after"
  databricks bundle plan -o json \
    | python3 "$SCRIPT_DIR/sanitize.py" > "$fixture_dir/plan.json.tmp"
  mv "$fixture_dir/plan.json.tmp" "$fixture_dir/plan.json"

  echo "==> [$name] Deploying after/ state..."
  cd "$fixture_dir/after"
  databricks bundle deploy --auto-approve

  echo "==> [$name] Destroying deployed state..."
  cd "$fixture_dir/after"
  databricks bundle destroy --auto-approve

  trap - EXIT
  echo "==> [$name] Done: $fixture_dir/plan.json"
)

if [[ "${1:-}" == "--all" ]]; then
  for before_dir in "$GOLDEN_DIR"/*/before; do
    [[ -d "$before_dir" ]] || continue
    name="$(basename "$(dirname "$before_dir")")"
    regen_one "$name"
    echo ""
  done
  echo "All fixtures regenerated."
elif [[ -n "${1:-}" ]]; then
  regen_one "$1"
else
  echo "Usage: fixtures/regen.sh <fixture-name> | --all" >&2
  exit 1
fi
