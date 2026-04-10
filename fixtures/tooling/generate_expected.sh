#!/usr/bin/env bash
# Generate or check expected dagshund output for golden fixture(s).
#
# Usage:
#   fixtures/tooling/generate_expected.sh [<fixture-name> | --all]
#       Generate expected.txt and expected.md from current CLI output.
#       Default target is --all if no fixture name is given.
#   fixtures/tooling/generate_expected.sh --check [<fixture-name> | --all]
#       Diff current CLI output against stored expected files.
#       Exits 0 on match, 1 on any mismatch or missing file, 2 on bad args.
#
# Environment:
#   DAGSHUND   how to invoke dagshund (default: "uv run dagshund")
#   NO_COLOR   forced to "1" (exported) so output is deterministic
#
# Does NOT require Databricks access — only needs plan.json files already
# captured by regen.sh.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
GOLDEN_DIR="$SCRIPT_DIR/../golden"
DAGSHUND="${DAGSHUND:-uv run dagshund}"
EXTRACT_GRAPH="$SCRIPT_DIR/../../js/scripts/extract-graph.ts"

export NO_COLOR=1

TMPDIR_RUN="$(mktemp -d)"
# Cleanup on normal exit, errexit trip, or signal.
trap 'rm -rf "$TMPDIR_RUN"' EXIT INT TERM HUP

# Print the header comment block as usage. Stops at first non-comment line,
# so adding/removing header lines doesn't require updating hardcoded ranges.
usage() {
  sed -n '/^#!/!{ /^[^#]/q; s/^# \{0,1\}//; p; }' "$0"
}

generate_one() {
  local name="$1"
  local fixture_dir="$GOLDEN_DIR/$name"
  local plan="$fixture_dir/plan.json"

  if [[ ! -f "$plan" ]]; then
    echo "ERROR: [$name] missing plan.json" >&2
    return 1
  fi

  echo "==> [$name] Generating expected output..."
  # shellcheck disable=SC2086  # intentional word-split on $DAGSHUND
  $DAGSHUND "$plan" > "$fixture_dir/expected.txt.tmp"
  mv "$fixture_dir/expected.txt.tmp" "$fixture_dir/expected.txt"
  # shellcheck disable=SC2086
  $DAGSHUND "$plan" --format md > "$fixture_dir/expected.md.tmp"
  mv "$fixture_dir/expected.md.tmp" "$fixture_dir/expected.md"

  # Capture detailed exit code (-e: 0/2/3) with -q to suppress stdout.
  # The `|| exit_code=$?` idiom bypasses errexit without toggling set -e.
  local exit_code=0
  # shellcheck disable=SC2086
  $DAGSHUND -q -e "$plan" >/dev/null 2>&1 || exit_code=$?
  echo "$exit_code" > "$fixture_dir/expected-exit.txt.tmp"
  mv "$fixture_dir/expected-exit.txt.tmp" "$fixture_dir/expected-exit.txt"

  # Extract structural graph summary via the Bun script. Imports the real
  # graph-builder modules so any drift is caught here, not in the browser.
  bun run "$EXTRACT_GRAPH" "$plan" > "$fixture_dir/expected-graph.json.tmp"
  mv "$fixture_dir/expected-graph.json.tmp" "$fixture_dir/expected-graph.json"

  echo "  wrote expected.txt, expected.md, expected-exit.txt, expected-graph.json"
}

check_one() {
  local name="$1"
  local fixture_dir="$GOLDEN_DIR/$name"
  local plan="$fixture_dir/plan.json"

  if [[ ! -f "$plan" ]]; then
    echo "ERROR: [$name] missing plan.json" >&2
    return 1
  fi
  if [[ ! -f "$fixture_dir/expected.txt" ]]; then
    echo "ERROR: [$name] missing expected.txt (run without --check to generate)" >&2
    return 1
  fi
  if [[ ! -f "$fixture_dir/expected.md" ]]; then
    echo "ERROR: [$name] missing expected.md (run without --check to generate)" >&2
    return 1
  fi
  if [[ ! -f "$fixture_dir/expected-exit.txt" ]]; then
    echo "ERROR: [$name] missing expected-exit.txt (run without --check to generate)" >&2
    return 1
  fi
  if [[ ! -f "$fixture_dir/expected-graph.json" ]]; then
    echo "ERROR: [$name] missing expected-graph.json (run without --check to generate)" >&2
    return 1
  fi

  local tmp_txt="$TMPDIR_RUN/$name.txt"
  local tmp_md="$TMPDIR_RUN/$name.md"
  local tmp_graph="$TMPDIR_RUN/$name.graph.json"
  local failed=0

  # shellcheck disable=SC2086
  if ! $DAGSHUND "$plan" > "$tmp_txt"; then
    echo "ERROR: [$name] dagshund failed on text output" >&2
    return 1
  fi
  # shellcheck disable=SC2086
  if ! $DAGSHUND "$plan" --format md > "$tmp_md"; then
    echo "ERROR: [$name] dagshund failed on md output" >&2
    return 1
  fi

  if ! diff -u "$fixture_dir/expected.txt" "$tmp_txt"; then
    echo "FAIL: [$name] expected.txt mismatch" >&2
    failed=1
  fi
  if ! diff -u "$fixture_dir/expected.md" "$tmp_md"; then
    echo "FAIL: [$name] expected.md mismatch" >&2
    failed=1
  fi

  # Detailed exit code check: -e maps to 0/2/3, -q suppresses stdout.
  local actual_exit=0
  # shellcheck disable=SC2086
  $DAGSHUND -q -e "$plan" >/dev/null 2>&1 || actual_exit=$?
  local expected_exit
  expected_exit=$(< "$fixture_dir/expected-exit.txt")
  if [[ "$actual_exit" != "$expected_exit" ]]; then
    echo "FAIL: [$name] expected-exit.txt mismatch: expected $expected_exit, got $actual_exit" >&2
    failed=1
  fi

  # Graph structure check: extract live graph JSON and diff against expected.
  if ! bun run "$EXTRACT_GRAPH" "$plan" > "$tmp_graph"; then
    echo "ERROR: [$name] graph extractor failed" >&2
    return 1
  fi
  if ! diff -u "$fixture_dir/expected-graph.json" "$tmp_graph"; then
    echo "FAIL: [$name] expected-graph.json mismatch" >&2
    failed=1
  fi

  if [[ $failed -eq 0 ]]; then
    echo "  ok: [$name]"
  fi
  return $failed
}

# --- arg parsing ---
MODE="generate"
TARGET=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --check)
      MODE="check"
      ;;
    --all)
      if [[ -n "$TARGET" ]]; then
        echo "ERROR: cannot combine --all with a fixture name" >&2
        exit 2
      fi
      TARGET="--all"
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    --*)
      echo "ERROR: unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
    *)
      if [[ -n "$TARGET" ]]; then
        echo "ERROR: cannot combine --all or multiple fixture names" >&2
        exit 2
      fi
      TARGET="$1"
      ;;
  esac
  shift
done

# Default target = --all (applies to both generate and check).
[[ -z "$TARGET" ]] && TARGET="--all"

run_one() {
  if [[ "$MODE" == "check" ]]; then
    check_one "$1"
  else
    generate_one "$1"
  fi
}

# Iterate fixture directories (bash glob yields lexically-sorted results).
# Loose files under golden/ (broken-json.json, bundle_config_schema.json,
# externals.yaml, invalid-plan.json) are intentionally skipped — the glob
# below only matches directories containing a plan.json.
FAILED=0
if [[ "$TARGET" == "--all" ]]; then
  for plan_file in "$GOLDEN_DIR"/*/plan.json; do
    # Guard handles the no-match case (literal glob string) under set -u.
    [[ -f "$plan_file" ]] || continue
    name="$(basename "$(dirname "$plan_file")")"
    run_one "$name" || FAILED=$((FAILED + 1))
  done
else
  run_one "$TARGET" || FAILED=$((FAILED + 1))
fi

if (( FAILED > 0 )); then
  echo ""
  echo "FAILED: $FAILED fixture(s)" >&2
  exit 1
fi

echo ""
if [[ "$MODE" == "check" ]]; then
  echo "All golden checks passed."
else
  echo "All expected outputs generated."
fi
