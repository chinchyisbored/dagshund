import { serve } from "bun";
import index from "./index.html";
import { parsePlanFromString } from "./parser/parse-plan.ts";
import type { Plan } from "./types/plan-schema.ts";

const readStdinPlan = async (): Promise<Plan | null> => {
  if (process.stdin.isTTY) {
    return null;
  }

  const input = await Bun.stdin.text();
  if (!input.trim()) {
    return null;
  }

  const result = parsePlanFromString(input);
  if (!result.ok) {
    console.error(`dagshund: failed to parse plan: ${result.error}`);
    process.exit(1);
  }

  return result.data;
};

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

const plan = await readStdinPlan();

const server = serve({
  routes: {
    "/api/plan": () => Response.json(plan),
    "/*": index,
  },

  development: process.env.NODE_ENV !== "production" && {
    hmr: true,
    console: true,
  },
});

console.log(`dagshund running at ${server.url}`);

if (plan) {
  Bun.spawn([detectOpenCommand(), server.url.toString()]);
}
