/**
 * Shared HTML assembler used by both cli.ts (live plan export)
 * and build-template.ts (Python template with placeholder).
 *
 * Single source of truth for: escape helpers, inline scripts,
 * the HTML template, and dist-asset reading.
 */

import { join } from "node:path";

// --- Escape helpers ---

/**
 * Escape a JS code bundle for embedding inside a `<script>` tag.
 *
 * Pattern-based: only neutralises the two sequences that can break a
 * `<script>` block in the HTML parser (`</script` and `<!--`).
 * Universal `<` replacement is NOT safe here because `\u003c` is only
 * a valid JS token inside string/template literals, not as an operator.
 */
export const escapeForScriptTag = (content: string): string =>
  content.replace(/<\/script/gi, "<\\/script").replace(/<!--/g, "<\\!--");

/**
 * Escape a JSON/data string for embedding inside a `<script>` tag.
 *
 * Replaces every `<` with `\u003c` — the industry-standard approach
 * (Django, Rails, etc.) that eliminates an entire class of injection
 * vectors, not just `</script` and `<!--`.
 *
 * Only safe for JSON / data strings, NOT arbitrary JS code.
 * Keep in sync with `_escape_for_script_tag()` in `src/dagshund/browser.py`.
 */
export const escapeJsonForScript = (content: string): string => content.replaceAll("<", "\\u003c");

export const escapeForStyleTag = (content: string): string =>
  content.replace(/<\/style/gi, "<\\/style");

// --- Inline scripts (must run before React mounts) ---

/** Theme detection — applies dark/high-contrast class before first paint. */
const THEME_INIT_SCRIPT = `(function() {
      var t = localStorage.getItem('dagshund-theme');
      if (t === 'high-contrast') { document.documentElement.classList.add('high-contrast'); return; }
      if (t === 'light' || (!t && window.matchMedia('(prefers-color-scheme: light)').matches)) return;
      document.documentElement.classList.add('dark');
    })();`;

/** Suppress React Flow's benign ResizeObserver "loop completed" warning. */
const RESIZE_OBSERVER_SCRIPT = `window.addEventListener("error", function(e) {
      if (e.message && e.message.startsWith("ResizeObserver loop")) e.stopImmediatePropagation();
    });`;

// --- HTML assembly ---

/**
 * Build a self-contained HTML page.
 *
 * @param css      - CSS content to inline in a <style> tag
 * @param js       - JS bundle content to inline in a <script type="module"> tag
 * @param planSlot - Either a JSON string (for live export) or a raw placeholder
 *                   token like `__DAGSHUND_PLAN_JSON__` (for the Python template).
 *                   Inserted verbatim into `window.__DAGSHUND_PLAN__ = <planSlot>;`
 */
export const assembleHtml = (css: string, js: string, planSlot: string): string => {
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
    ${THEME_INIT_SCRIPT}
    ${RESIZE_OBSERVER_SCRIPT}
  </script>
  <script>window.__DAGSHUND_PLAN__ = ${planSlot};</script>
  <script type="module">${safeJs}</script>
</body>
</html>`;
};

// --- Build + asset reading ---

const JS_ROOT = join(import.meta.dir, "..");

export const buildJsBundle = async (): Promise<void> => {
  const proc = Bun.spawn(["bun", "run", "build"], {
    cwd: JS_ROOT,
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    console.error(`dagshund: build failed with exit code ${exitCode}`);
    process.exit(1);
  }
};

export const loadBuiltAssets = async (): Promise<{
  readonly js: string;
  readonly css: string;
}> => {
  const distDir = join(JS_ROOT, "dist");
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
