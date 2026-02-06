# Dagshund

Interactive web-based visualizer for `databricks bundle plan -o json` output.
Shows job task DAGs with diff highlighting for added, removed, modified, and unchanged resources.

## Prerequisites

- [Bun](https://bun.com) v1.3.8+

## Getting Started

```bash
bun install
```

## Development

```bash
bun run dev        # Start dev server with hot reload (http://localhost:3000)
bun run lint       # Check code with Biome
bun run lint:fix   # Auto-fix lint issues
bun run test       # Run tests
bun run build      # Production build to dist/
```

## Production

```bash
bun run build      # Build for production
bun run start      # Serve production build
```
