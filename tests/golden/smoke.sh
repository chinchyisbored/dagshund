#!/usr/bin/env bash
# Golden-file smoke tests for dagshund CLI text output.
# Usage:
#   ./smoke.sh generate  — regenerate golden files from current source
#   ./smoke.sh check     — diff output against golden files (exit 1 on mismatch)
#
# The DAGSHUND variable controls how dagshund is invoked.
# Default: "uv run dagshund" (from source). Override for wheel testing:
#   DAGSHUND=dagshund ./smoke.sh check
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
GOLDEN_DIR="$SCRIPT_DIR"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
FIXTURES="$PROJECT_DIR/fixtures"
DAGSHUND="${DAGSHUND:-uv run dagshund}"

export NO_COLOR=1

# Test matrix: fixture|flags|golden-file
# Each line is one test case. Flags may be empty.
CASES=(
  "sample-plan.json||sample-plan.txt"
  "complex-plan.json||complex-plan.txt"
  "no-changes-plan.json||no-changes-plan.txt"
  "all-hierarchies-plan.json||all-hierarchies-plan.txt"
  "mixed-plan.json||mixed-plan.txt"
  "complex-plan.json|-a|complex-plan--added.txt"
  "complex-plan.json|-r|complex-plan--removed.txt"
  "complex-plan.json|-m|complex-plan--modified.txt"
  "complex-plan.json|-c|complex-plan--changes-only.txt"
  "mixed-plan.json|-a|mixed-plan--added.txt"
  "mixed-plan.json|-r|mixed-plan--removed.txt"
  "mixed-plan.json|-m|mixed-plan--modified.txt"
  "mixed-plan.json|-c|mixed-plan--changes-only.txt"
  "complex-plan.json|-f type:jobs|complex-plan--filter-type-jobs.txt"
  "mixed-plan.json|-f type:alerts|mixed-plan--filter-type-alerts.txt"
  "mixed-plan.json|-f status:added|mixed-plan--filter-status-added.txt"
  "mixed-plan.json|-f pipeline|mixed-plan--filter-fuzzy-pipeline.txt"
  "mixed-plan.json|-f \"etl_pipeline\"|mixed-plan--filter-exact-etl.txt"
  "mixed-plan.json|-c -f type:alerts|mixed-plan--changes-only--filter-type-alerts.txt"
  "mixed-plan.json|-a -r|mixed-plan--added--removed.txt"
)

run_dagshund() {
  local fixture="$1"
  local flags="$2"
  if [[ -z "$flags" ]]; then
    $DAGSHUND "$FIXTURES/$fixture"
  else
    # Word-split flags intentionally (they may contain multiple args like "-f type:jobs")
    # shellcheck disable=SC2086
    $DAGSHUND "$FIXTURES/$fixture" $flags
  fi
}

generate() {
  echo "Generating ${#CASES[@]} golden files..."
  for entry in "${CASES[@]}"; do
    IFS='|' read -r fixture flags golden <<< "$entry"
    run_dagshund "$fixture" "$flags" > "$GOLDEN_DIR/$golden"
    echo "  wrote $golden"
  done
  echo "Done."
}

check() {
  local failures=0
  echo "Checking ${#CASES[@]} golden files..."
  for entry in "${CASES[@]}"; do
    IFS='|' read -r fixture flags golden <<< "$entry"
    actual=$(run_dagshund "$fixture" "$flags")
    if ! diff -u "$GOLDEN_DIR/$golden" - <<< "$actual"; then
      echo "FAIL: $golden"
      failures=$((failures + 1))
    else
      echo "  ok: $golden"
    fi
  done

  # Non-golden checks
  echo ""
  echo "Non-golden checks..."

  # --version
  if $DAGSHUND --version | grep -q "dagshund"; then
    echo "  ok: --version"
  else
    echo "FAIL: --version"
    failures=$((failures + 1))
  fi

  # broken JSON exits 1
  if $DAGSHUND "$FIXTURES/broken-json-plan.json" 2>/dev/null; then
    echo "FAIL: broken-json-plan.json should exit 1"
    failures=$((failures + 1))
  else
    echo "  ok: broken-json-plan.json (exit 1)"
  fi

  echo ""
  if [[ $failures -gt 0 ]]; then
    echo "FAILED: $failures check(s) failed"
    exit 1
  fi
  echo "All checks passed."
}

case "${1:-}" in
  generate) generate ;;
  check)    check ;;
  *)
    echo "Usage: $0 {generate|check}" >&2
    exit 1
    ;;
esac
