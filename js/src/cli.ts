import { randomUUID } from "node:crypto";
import { chmodSync } from "node:fs";
import { join, resolve } from "node:path";
import { assembleHtml, escapeJsonForScript, readDistAssets, runBuild } from "./html-assembler.ts";
import { parsePlanFromString } from "./parser/parse-plan.ts";
import type { Plan } from "./types/plan-schema.ts";
import { tryOpenBrowser } from "./utils/open-browser.ts";

// --- Arg parsing ---

type CliArgs = {
  readonly inputPath: string | undefined;
  readonly outputPath: string | undefined;
};

const parseArgs = (argv: readonly string[]): CliArgs => {
  const args = argv.slice(2);
  const outputFlagIndex = args.findIndex((a) => a === "-o" || a === "--output");

  const outputPath = outputFlagIndex !== -1 ? args[outputFlagIndex + 1] : undefined;

  const positionalArgs =
    outputFlagIndex === -1
      ? args
      : args.filter((_, i) => i !== outputFlagIndex && i !== outputFlagIndex + 1);

  return {
    inputPath: positionalArgs[0],
    outputPath,
  };
};

// --- Plan reading ---

const ALLOWED_EXTENSIONS: ReadonlySet<string> = new Set([".json", ".yaml", ".yml"]);

const sanitizePath = (raw: string): string => {
  const resolved = resolve(raw);
  if (raw.includes("..")) {
    console.warn(`dagshund: warning: path contains '..' sequences, resolved to ${resolved}`);
  }
  const extension = resolved.slice(resolved.lastIndexOf(".")).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(extension)) {
    console.warn(`dagshund: warning: unexpected file extension '${extension}'`);
  }
  return resolved;
};

const readPlanFromFile = async (path: string): Promise<Plan> => {
  const file = Bun.file(sanitizePath(path));
  const exists = await file.exists();
  if (!exists) {
    console.error(`dagshund: file not found: ${path}`);
    process.exit(1);
  }
  const content = await file.text();
  const result = parsePlanFromString(content);
  if (!result.ok) {
    console.error(`dagshund: failed to parse plan: ${result.error}`);
    process.exit(1);
  }
  return result.data;
};

const readPlanFromStdin = async (): Promise<Plan> => {
  const input = await Bun.stdin.text();
  if (!input.trim()) {
    console.error("dagshund: no input received on stdin");
    process.exit(1);
  }
  const result = parsePlanFromString(input);
  if (!result.ok) {
    console.error(`dagshund: failed to parse plan: ${result.error}`);
    process.exit(1);
  }
  return result.data;
};

const readPlan = async (inputPath: string | undefined): Promise<Plan> => {
  if (inputPath) {
    return readPlanFromFile(inputPath);
  }
  if (!process.stdin.isTTY) {
    return readPlanFromStdin();
  }
  console.error("dagshund: no input file specified and stdin is a TTY");
  console.error("Usage: bun src/cli.ts <plan.json> [-o output.html]");
  console.error("       cat plan.json | bun src/cli.ts [-o output.html]");
  process.exit(1);
};

// --- Main ---

const main = async (): Promise<void> => {
  const { inputPath, outputPath } = parseArgs(process.argv);

  const plan = await readPlan(inputPath);
  console.log("dagshund: plan validated, building assets...");

  await runBuild();
  const { js, css } = await readDistAssets();
  const safeJson = escapeJsonForScript(JSON.stringify(plan));
  const html = assembleHtml(css, js, safeJson);

  if (outputPath) {
    await Bun.write(outputPath, html);
    console.log(`dagshund: exported to ${outputPath}`);
  } else {
    const tmpDir = process.env["XDG_RUNTIME_DIR"] ?? process.env["TMPDIR"] ?? "/tmp";
    const tmpPath = join(tmpDir, `dagshund-${randomUUID()}.html`);
    await Bun.write(tmpPath, html);
    chmodSync(tmpPath, 0o600);
    console.log(`dagshund: opening ${tmpPath}`);
    await tryOpenBrowser(tmpPath);
  }
};

await main();
