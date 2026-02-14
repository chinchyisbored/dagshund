/**
 * Builds template.html with a __DAGSHUND_PLAN_JSON__ placeholder
 * for the Python package to inject real plan data at runtime.
 */

import { join } from "node:path";
import { assembleHtml, readDistAssets, runBuild } from "../src/html-assembler.ts";

const PLACEHOLDER = "__DAGSHUND_PLAN_JSON__";

const main = async (): Promise<void> => {
  console.log("build-template: building JS assets...");
  await runBuild();
  const { js, css } = await readDistAssets();
  const template = assembleHtml(css, js, PLACEHOLDER);

  const outputPath = join(import.meta.dir, "..", "src", "dagshund", "_assets", "template.html");
  await Bun.write(outputPath, template);
  console.log(`build-template: wrote ${outputPath}`);
};

await main();
