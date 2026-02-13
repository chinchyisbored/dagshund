.PHONY: dev build test lint export install typecheck template

install:
	cd js && bun install

dev:
	cd js && bun run dev

build:
	cd js && bun run build

test:
	cd js && bun test

lint:
	cd js && bun run lint

export:
	cd js && bun run export

typecheck:
	cd js && bunx tsc --noEmit

template:
	cd js && bun run build:template
