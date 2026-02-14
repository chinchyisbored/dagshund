# JS commands (run from js/ directory)
install:
    cd js && bun install

dev:
    cd js && bun run dev

build:
    cd js && bun run build

test-js:
    cd js && bun test

lint-js:
    cd js && bun run lint

typecheck-js:
    cd js && bunx tsc --noEmit

export:
    cd js && bun run export

template:
    cd js && bun run build:template

# Python commands
test-py:
    uv run pytest

lint-py:
    uv run ruff check src/ tests/

format-py:
    uv run ruff format src/ tests/

typecheck-py:
    uv run ty check src/ tests/

# Combined
test: test-js test-py
lint: lint-js lint-py
typecheck: typecheck-js typecheck-py

# Quality gates
check: lint typecheck test

# Pre-commit hooks
hooks-install:
    uv run prek install

hooks-run:
    uv run prek run --all-files
