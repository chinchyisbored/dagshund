import { useEffect, useState } from "react";
import { parsePlanJson } from "../parser/parse-plan.ts";
import type { Plan } from "../types/plan-schema.ts";

type StdinPlanState =
  | { readonly status: "loading" }
  | { readonly status: "empty" }
  | { readonly status: "ready"; readonly plan: Plan }
  | { readonly status: "error"; readonly message: string };

const INITIAL_STATE: StdinPlanState = { status: "loading" };

export const useStdinPlan = (): StdinPlanState => {
  const [state, setState] = useState<StdinPlanState>(INITIAL_STATE);

  useEffect(() => {
    // Window augmentation: the build step injects plan data as a global for self-contained HTML exports.
    const embedded = (window as { __DAGSHUND_PLAN__?: unknown }).__DAGSHUND_PLAN__;
    if (embedded !== undefined) {
      const result = parsePlanJson(embedded);
      if (result.ok) {
        setState({ status: "ready", plan: result.data });
      } else {
        setState({ status: "error", message: result.error });
      }
      return;
    }

    const fetchPlan = async () => {
      try {
        const response = await fetch("/api/plan");
        const data: unknown = await response.json();

        if (data === null) {
          setState({ status: "empty" });
          return;
        }

        const result = parsePlanJson(data);
        if (result.ok) {
          setState({ status: "ready", plan: result.data });
        } else {
          setState({ status: "error", message: result.error });
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Failed to fetch plan";
        setState({ status: "error", message });
      }
    };

    fetchPlan();
  }, []);

  return state;
};
