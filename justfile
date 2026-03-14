root := justfile_directory()
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

# Start JS dev server in background (plan file path relative to repo root)
dev plan_file="fixtures/complex-plan.json":
    #!/usr/bin/env bash
    bun run --cwd {{js_dir}} build:css
    bunx --cwd {{js_dir}} @tailwindcss/cli -i src/styles/index.css -o src/styles/output.css --watch &>/dev/null &
    tw_pid=$!
    cat "{{plan_file}}" | bun --hot --cwd {{js_dir}} src/index.ts &>/dev/null &
    bun_pid=$!
    mkdir -p {{root}}/.cache
    echo "$bun_pid $tw_pid" > {{root}}/.cache/dev-server.pid
    disown -a
    echo "Dev server starting on http://localhost:3000 — stop with: just dev-down"

# Kill the dagshund dev server
dev-down:
    #!/usr/bin/env bash
    pidfile="{{root}}/.cache/dev-server.pid"
    if [ -f "$pidfile" ]; then
        for pid in $(<"$pidfile"); do
            if kill -0 "$pid" 2>/dev/null; then
                kill "$pid"
                echo "Stopped pid $pid"
            fi
        done
        rm -f "$pidfile"
    else
        # Fallback: kill by port
        pid=$(fuser 3000/tcp 2>/dev/null)
        if [ -n "$pid" ]; then
            kill "$pid" && echo "Stopped process on port 3000 (pid $pid)"
        else
            echo "Nothing running on port 3000"
        fi
    fi

# Build JS template + Python wheel
build:
    bun run --cwd {{js_dir}} build:template
    cp {{root}}/plugins/dagshund/skills/dagshund/SKILL.md {{py_src}}/dagshund/_assets/SKILL.md
    uv build

# Run JS tests (optional filter: test file or name pattern)
test-js filter="":
    bun test --cwd {{js_dir}} {{ if filter == "" { "--coverage --coverage-reporter=text --coverage-reporter=lcov --coverage-dir " + root / ".cache/coverage-js" } else { "-t " + quote(filter) } }}

# Lint JS with biome (applies safe fixes)
lint-js:
    bun run --cwd {{js_dir}} biome check --fix src/ tests/

# Format JS with biome
format-js:
    bun run --cwd {{js_dir}} biome format --write src/ tests/

# Typecheck JS with tsc
typecheck-js:
    bun run --cwd {{js_dir}} tsc --noEmit

# Run Python tests (optional filter: -k expression or file::test path)
test-py filter="":
    uv run pytest {{ if filter == "" { "--cov=dagshund --cov-report=term-missing" } else { "-xvs -k " + quote(filter) } }}

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

# Check golden files against current output
test-golden:
    ./tests/golden/smoke.sh check

# Regenerate golden files from current source
update-golden:
    ./tests/golden/smoke.sh generate

# Run all quality gates (lint + typecheck + test + golden)
check: lint typecheck test test-golden

# Run pre-commit hooks on all files
hooks-run:
    uv run prek run --all-files
