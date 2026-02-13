import { useEffect, useState } from "react";
import { buildPlanGraph } from "../graph/build-plan-graph.ts";
import { toReactFlowElements } from "../graph/layout-graph.ts";
import type { LayoutResult } from "../types/layout-result.ts";
import type { Plan } from "../types/plan-schema.ts";

export type GraphLayoutState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly layout: LayoutResult }
  | { readonly status: "error"; readonly message: string };

/** Async transformation of Plan → React Flow nodes and edges. */
export const usePlanGraph = (plan: Plan): GraphLayoutState => {
  const [state, setState] = useState<GraphLayoutState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });

    toReactFlowElements(buildPlanGraph(plan)).then(
      (layout) => {
        if (!cancelled) setState({ status: "ready", layout });
      },
      (error: unknown) => {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : "Layout failed";
          console.error("Plan graph layout failed:", error);
          setState({ status: "error", message });
        }
      },
    );

    return () => {
      cancelled = true;
    };
  }, [plan]);

  return state;
};
