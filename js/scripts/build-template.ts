/**
 * Builds template.html with a __DAGSHUND_PLAN_JSON__ placeholder
 * for the Python package to inject real plan data at runtime.
 */

import { join } from "node:path";

const PLACEHOLDER = "__DAGSHUND_PLAN_JSON__";

const runBuild = async (): Promise<void> => {
  const proc = Bun.spawn(["bun", "run", "build"], {
    cwd: join(import.meta.dir, ".."),
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    console.error(`build-template: build failed with exit code ${exitCode}`);
    process.exit(1);
  }
};

const readDistAssets = async (): Promise<{
  readonly js: string;
  readonly css: string;
}> => {
  const distDir = join(import.meta.dir, "..", "dist");
  const buildHtml = await Bun.file(`${distDir}/index.html`).text();
  const jsMatch = buildHtml.match(/src="\.\/([^"]+\.js)"/);
  const cssMatch = buildHtml.match(/href="\.\/([^"]+\.css)"/);
  const jsFile = jsMatch?.[1];
  const cssFile = cssMatch?.[1];

  if (!jsFile || !cssFile) {
    console.error("build-template: could not find JS/CSS references in built HTML");
    process.exit(1);
  }

  const js = await Bun.file(`${distDir}/${jsFile}`).text();
  const css = await Bun.file(`${distDir}/${cssFile}`).text();
  return { js, css };
};

const escapeForScriptTag = (content: string): string =>
  content.replace(/<\/script/gi, "<\\/script").replace(/<!--/g, "<\\!--");

const escapeForStyleTag = (content: string): string =>
  content.replace(/<\/style/gi, "<\\/style");

const assembleTemplate = (css: string, js: string): string => {
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
  <script>window.__DAGSHUND_PLAN__ = ${PLACEHOLDER};</script>
  <script type="module">${safeJs}</script>
</body>
</html>`;
};

const main = async (): Promise<void> => {
  console.log("build-template: building JS assets...");
  await runBuild();
  const { js, css } = await readDistAssets();
  const template = assembleTemplate(css, js);

  const outputPath = join(import.meta.dir, "..", "..", "src", "dagshund", "_assets", "template.html");
  await Bun.write(outputPath, template);
  console.log(`build-template: wrote ${outputPath}`);
};

await main();
