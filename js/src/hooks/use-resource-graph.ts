import { useEffect, useState } from "react";
import { buildResourceGraph } from "../graph/build-resource-graph.ts";
import { layoutResourceGraph } from "../graph/layout-graph.ts";
import type { Plan } from "../types/plan-schema.ts";
import type { GraphLayoutState } from "./use-plan-graph.ts";

/** Async transformation of Plan → React Flow nodes and edges for non-job resources. */
export const useResourceGraph = (plan: Plan): GraphLayoutState => {
  const [state, setState] = useState<GraphLayoutState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });

    layoutResourceGraph(buildResourceGraph(plan)).then(
      (layout) => {
        if (!cancelled) setState({ status: "ready", layout });
      },
      (error: unknown) => {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : "Layout failed";
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
