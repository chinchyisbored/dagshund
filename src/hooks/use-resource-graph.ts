import { useEffect, useState } from "react";
import { buildResourceGraph } from "../graph/build-resource-graph.ts";
import { layoutResourceGraph } from "../graph/layout-graph.ts";
import type { LayoutResult } from "../types/layout-result.ts";
import type { Plan } from "../types/plan-schema.ts";

/** Async transformation of Plan → React Flow nodes and edges for non-job resources. */
export const useResourceGraph = (plan: Plan): LayoutResult | null => {
  const [result, setResult] = useState<LayoutResult | null>(null);

  useEffect(() => {
    let cancelled = false;

    layoutResourceGraph(buildResourceGraph(plan)).then((layout) => {
      if (!cancelled) {
        setResult(layout);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [plan]);

  return result;
};
