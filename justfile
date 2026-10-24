root := justfile_directory()
js_dir := root / "js"
py_src := root / "src"
py_tests := root / "tests"
py_tooling := root / "fixtures" / "tooling"

[private]
default:
    @just --list --unsorted

# Install all deps and git hooks
install:
    set -euo pipefail
    uv sync --locked
    bun install --cwd {{ js_dir }} --frozen-lockfile
    uv run prek install

# Start process compose with planfile
dev plan_file="fixtures/golden/mixed-changes/plan.json":
    PLAN_FILE="{{ plan_file }}" process-compose up

# Build JS template + Python wheel
build:
    bun run --cwd {{ js_dir }} build:template
    cp {{ root }}/skills/dagshund/SKILL.md {{ py_src }}/dagshund/_assets/SKILL.md
    uv build

# Run JS tests
test-js:
    AGENT=1 bun test --cwd {{ js_dir }} --coverage --coverage-reporter=lcov --coverage-dir {{ root }}/.cache/coverage-js

# Lint JS with biome (applies safe fixes)
lint-js:
    bun run --cwd {{ js_dir }} biome check --fix src/ tests/

# Format JS with biome
format-js:
    bun run --cwd {{ js_dir }} biome format --write src/ tests/

# Typecheck JS with tsc
typecheck-js:
    bun run --cwd {{ js_dir }} tsc --noEmit

# Run Python tests
test-py:
    uv run pytest -q --cov=dagshund --cov-report=

# Run Python tests with an explicit interpreter and isolated environment
_test-py-with-python python env:
    UV_PROJECT_ENVIRONMENT="{{ env }}" uv run --locked --python "{{ python }}" pytest -q

# Run Python tests on every supported minor
test-py-supported:
    just _test-py-with-python "{{ env_var('DAGSHUND_PYTHON312') }}" .cache/venv-py312
    just _test-py-with-python "{{ env_var('DAGSHUND_PYTHON313') }}" .cache/venv-py313
    just _test-py-with-python "{{ env_var('DAGSHUND_PYTHON314') }}" .cache/venv-py314

# Lint Python with ruff
lint-py:
    uv run ruff check --fix {{ py_src }} {{ py_tests }} {{ py_tooling }}

# Format Python with ruff
format-py:
    uv run ruff format {{ py_src }} {{ py_tests }} {{ py_tooling }}

# Typecheck Python with ty
typecheck-py:
    uv run ty check {{ py_src }} {{ py_tests }} {{ py_tooling }}

# Run all tests
test: test-js test-py

# Run all linters
lint: lint-js lint-py

# Format all code
format: format-js format-py

# Run all typecheckers
typecheck: typecheck-js typecheck-py

# Check golden files against current output
test-golden:
    {{ py_tooling }}/generate_expected.sh --check

# Run all quality gates (lint + typecheck + test + golden)
check: lint typecheck test test-golden

# Regenerate golden fixture(s) from Databricks (local only, requires auth)
regen name="--all":
    {{ py_tooling }}/regen.sh "{{ name }}"

# Generate expected output for golden fixture(s)
gen-expected name="--all":
    {{ py_tooling }}/generate_expected.sh "{{ name }}"

# Run pre-commit hooks on all files
hooks-run:
    uv run prek run --all-files
