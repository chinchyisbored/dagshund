import { chmodSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { parsePlanFromString } from "./parser/parse-plan.ts";
import type { Plan } from "./types/plan-schema.ts";

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

// --- Build + asset reading ---

const runBuild = async (): Promise<void> => {
  const proc = Bun.spawn(["bun", "run", "build"], {
    cwd: import.meta.dir.replace(/\/src$/, ""),
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    console.error(`dagshund: build failed with exit code ${exitCode}`);
    process.exit(1);
  }
};

const readDistAssets = async (): Promise<{
  readonly js: string;
  readonly css: string;
}> => {
  const distDir = `${import.meta.dir.replace(/\/src$/, "")}/dist`;
  const glob = new Bun.Glob("*");

  const jsFiles: string[] = [];
  const cssFiles: string[] = [];

  for await (const entry of glob.scan({ cwd: distDir })) {
    if (entry.endsWith(".js") && !entry.endsWith(".js.map")) {
      jsFiles.push(entry);
    }
    if (entry.endsWith(".css")) {
      cssFiles.push(entry);
    }
  }

  // The build HTML references specific files — parse it to find the right ones
  const buildHtml = await Bun.file(`${distDir}/index.html`).text();
  const jsMatch = buildHtml.match(/src="\.\/([^"]+\.js)"/);
  const cssMatch = buildHtml.match(/href="\.\/([^"]+\.css)"/);

  const jsFile = jsMatch?.[1];
  const cssFile = cssMatch?.[1];

  if (!jsFile || !cssFile) {
    console.error("dagshund: could not find JS/CSS references in built HTML");
    console.error(`  JS files found: ${jsFiles.join(", ")}`);
    console.error(`  CSS files found: ${cssFiles.join(", ")}`);
    process.exit(1);
  }

  const js = await Bun.file(`${distDir}/${jsFile}`).text();
  const css = await Bun.file(`${distDir}/${cssFile}`).text();

  return { js, css };
};

// --- HTML assembly ---

const escapeForScriptTag = (content: string): string =>
  content.replace(/<\/script/gi, "<\\/script").replace(/<!--/g, "<\\!--");

const escapeForStyleTag = (content: string): string =>
  content.replace(/<\/style/gi, "<\\/style");

const assembleHtml = (css: string, js: string, planData: Plan): string => {
  const safeJson = escapeForScriptTag(JSON.stringify(planData));
  const safeJs = escapeForScriptTag(js);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:;" />
  <title>dagshund</title>
  <style>${escapeForStyleTag(css)}</style>
</head>
<body>
  <div id="root"></div>
  <script>
    (function() {
      var t = localStorage.getItem('dagshund-theme');
      if (t === 'high-contrast') { document.documentElement.classList.add('high-contrast'); return; }
      if (t === 'light' || (!t && window.matchMedia('(prefers-color-scheme: light)').matches)) return;
      document.documentElement.classList.add('dark');
    })();
    window.addEventListener("error", function(e) {
      if (e.message && e.message.startsWith("ResizeObserver loop")) e.stopImmediatePropagation();
    });
  </script>
  <script>window.__DAGSHUND_PLAN__ = ${safeJson};</script>
  <script type="module">${safeJs}</script>
</body>
</html>`;
};

// --- Browser opening ---

const detectOpenCommand = (): string => {
  switch (process.platform) {
    case "darwin":
      return "open";
    case "win32":
      return "start";
    default:
      return "xdg-open";
  }
};

// --- Main ---

const main = async (): Promise<void> => {
  const { inputPath, outputPath } = parseArgs(process.argv);

  const plan = await readPlan(inputPath);
  console.log("dagshund: plan validated, building assets...");

  await runBuild();
  const { js, css } = await readDistAssets();
  const html = assembleHtml(css, js, plan);

  if (outputPath) {
    await Bun.write(outputPath, html);
    console.log(`dagshund: exported to ${outputPath}`);
  } else {
    // biome-ignore lint/complexity/useLiteralKeys: TypeScript strict noPropertyAccessFromIndexSignature requires bracket notation
    const tmpDir = process.env["XDG_RUNTIME_DIR"] ?? process.env["TMPDIR"] ?? "/tmp";
    const tmpPath = `${tmpDir}/dagshund-${randomUUID()}.html`;
    await Bun.write(tmpPath, html);
    chmodSync(tmpPath, 0o600);
    console.log(`dagshund: opening ${tmpPath}`);
    Bun.spawn([detectOpenCommand(), tmpPath]);
  }
};

await main();
