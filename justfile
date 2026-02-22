root := justfile_dir()
js_dir := root / "js"
py_src := root / "src"
py_tests := root / "tests"

[private]
default:
  @just --list --unsorted

# Install all deps and git hooks
install:
    uv sync
    bun install --cwd {{js_dir}}
    uv run prek install

# Start JS dev server in background
dev plan_file="fixtures/complex-plan.json":
    #!/usr/bin/env bash
    cat "{{plan_file}}" | bun run --cwd {{js_dir}} dev &>/dev/null &
    disown
    echo "Dev server starting on http://localhost:3000 — stop with: just dev-down"

# Kill the dagshund dev server on port 3000
dev-down:
    #!/usr/bin/env bash
    pid=$(fuser 3000/tcp 2>/dev/null)
    if [ -z "$pid" ]; then
        echo "Nothing running on port 3000"
        exit 0
    fi
    cmd=$(ps -p $pid -o comm= 2>/dev/null)
    if [ "$cmd" = "bun" ]; then
        kill $pid
        echo "Stopped bun (pid $pid)"
    else
        echo "Port 3000 is in use by '$cmd' (pid $pid), not bun — skipping"
    fi

# Build JS template + Python wheel
build:
    bun run --cwd {{js_dir}} build:template
    uv build

# Run JS tests
test-js:
    bun test --cwd {{js_dir}} --coverage --coverage-reporter=text --coverage-reporter=lcov --coverage-dir {{root / ".cache/coverage-js"}}

# Lint JS with biome
lint-js:
    bun run --cwd {{js_dir}} lint

# Format JS with biome
format-js:
    bun run --cwd {{js_dir}} format

# Typecheck JS with tsc
typecheck-js:
    bun run --cwd {{js_dir}} typecheck

# Run Python tests
test-py:
    uv run pytest --cov=dagshund --cov-report=term-missing

# Lint Python with ruff
lint-py:
    uv run ruff check --fix {{py_src}} {{py_tests}}

# Format Python with ruff
format-py:
    uv run ruff format {{py_src}} {{py_tests}}

# Typecheck Python with ty
typecheck-py:
    uv run ty check {{py_src}} {{py_tests}}

# Run all tests
test: test-js test-py

# Run all linters
lint: lint-js lint-py

# Format all code
format: format-js format-py

# Run all typecheckers
typecheck: typecheck-js typecheck-py

# Run all quality gates (lint + typecheck + test)
check: lint typecheck test

# Run pre-commit hooks on all files
hooks-run:
    uv run prek run --all-files
