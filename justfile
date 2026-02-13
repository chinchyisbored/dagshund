# JS commands (run from js/ directory)
install:
    cd js && bun install

dev:
    cd js && bun run dev

build:
    cd js && bun run build

test-js:
    cd js && bun test

lint:
    cd js && bun run lint

typecheck:
    cd js && bunx tsc --noEmit

export:
    cd js && bun run export

template:
    cd js && bun run build:template

# Python commands
test-py:
    uv run pytest tests/ -v

test: test-js test-py

# Quality gates
check: lint typecheck test
