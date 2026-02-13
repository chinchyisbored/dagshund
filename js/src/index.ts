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

const tryOpenBrowser = async (url: string): Promise<void> => {
  const proc = Bun.spawn([detectOpenCommand(), url], {
    stdout: "ignore",
    stderr: "ignore",
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    console.warn("dagshund: could not open browser automatically");
    console.warn(`dagshund: open this URL manually: ${url}`);
  }
};

const ALLOWED_HOSTS: ReadonlySet<string> = new Set([
  "localhost",
  "127.0.0.1",
]);

/** Reject requests with a Host header that doesn't match localhost to mitigate DNS rebinding. */
const isAllowedHost = (request: Request): boolean => {
  const host = request.headers.get("host");
  if (host === null) return false;
  const hostname = host.replace(/:\d+$/, "");
  return ALLOWED_HOSTS.has(hostname);
};

const FORBIDDEN_RESPONSE = () => new Response("Forbidden", { status: 403 });

const plan = await readStdinPlan();

const server = serve({
  hostname: "127.0.0.1",
  routes: {
    "/api/plan": (request) =>
      isAllowedHost(request) ? Response.json(plan) : FORBIDDEN_RESPONSE(),
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
