# dagshund 🐕

Your deployment plan's best friend.

Interactive visualizer for `databricks bundle plan -o json` output.
Renders job task DAGs with diff highlighting so you can see exactly what a deployment
will change before you run `bundle deploy`.

## Status

Early development. Not yet functional.

## What it does

- Parses the JSON output of `databricks bundle plan -o json` (direct deployment engine)
- Renders an interactive DAG for each job showing task dependencies
- Color-codes changes: green = new, red (faded) = deleted, amber = modified
- Click any node to inspect the full diff detail
- Zoom, pan, and navigate large DAGs

## Usage (planned)

```bash
# Feed plan output directly
databricks bundle plan -o json | npx dagshund

# Or upload a saved plan file in the UI
databricks bundle plan -o json > plan.json
npx dagshund
# Then drag & drop plan.json into the browser
```

## Development

```bash
npm install
npm run dev
```

## Tech Stack

- TypeScript, React 19, Vite
- React Flow for DAG rendering
- Zod for input validation
- Tailwind CSS

## License

MIT
