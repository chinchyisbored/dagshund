/**
 * Builds template.html with plan and provenance placeholders for the Python
 * package to inject real data at runtime.
 */

import { join } from "node:path";
import { assembleHtml, buildJsBundle, loadBuiltAssets } from "../src/html-assembler.ts";

const PLAN_PLACEHOLDER = "__DAGSHUND_PLAN_JSON__";
const PROVENANCE_PLACEHOLDER = "__DAGSHUND_PROVENANCE_JSON__";

const main = async (): Promise<void> => {
  console.log("build-template: building JS assets...");
  await buildJsBundle();
  const { js, css } = await loadBuiltAssets();
  const template = assembleHtml(css, js, PLAN_PLACEHOLDER, PROVENANCE_PLACEHOLDER);

  const outputPath = join(import.meta.dir, "..", "..", "src", "dagshund", "_assets", "template.html");
  await Bun.write(outputPath, template);
  console.log(`build-template: wrote ${outputPath}`);
};

await main();
