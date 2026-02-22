import { serve } from "bun";
import index from "./index.html";
import { parsePlanFromString } from "./parser/parse-plan.ts";
import type { Plan } from "./types/plan-schema.ts";
import { tryOpenBrowser } from "./utils/open-browser.ts";

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

const ALLOWED_HOSTS: ReadonlySet<string> = new Set(["localhost", "127.0.0.1"]);

/** Reject requests with a Host header that doesn't match localhost to mitigate DNS rebinding. */
const isAllowedHost = (request: Request): boolean => {
  const host = request.headers.get("host");
  if (host === null) return false;
  const hostname = host.replace(/:\d+$/, "");
  return ALLOWED_HOSTS.has(hostname);
};

const createForbiddenResponse = () => new Response("Forbidden", { status: 403 });

const plan = await readStdinPlan();

const server = serve({
  hostname: "127.0.0.1",
  routes: {
    "/api/plan": (request) =>
      isAllowedHost(request) ? Response.json(plan) : createForbiddenResponse(),
    // Static assets only (HTML/JS/CSS) — no secrets. Host validation on /api/plan
    // prevents DNS rebinding from accessing plan data. Bun's HTML import syntax
    // requires direct assignment here; wrapping in a handler loses bundling/HMR.
    "/*": index,
  },

  development: process.env.NODE_ENV !== "production" && {
    hmr: true,
    console: true,
  },
});

console.log(`dagshund running at ${server.url}`);

if (plan) {
  tryOpenBrowser(server.url.toString());
}
