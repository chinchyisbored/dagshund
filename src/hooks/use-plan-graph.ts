import type { Edge, Node } from "@xyflow/react";
import { useEffect, useState } from "react";
import { buildPlanGraph } from "../graph/build-plan-graph.ts";
import { toReactFlowElements } from "../graph/layout-graph.ts";
import type { Plan } from "../types/plan-schema.ts";

type LayoutResult = {
  readonly nodes: readonly Node[];
  readonly edges: readonly Edge[];
};

/** Async transformation of Plan → React Flow nodes and edges. */
export const usePlanGraph = (plan: Plan): LayoutResult | null => {
  const [result, setResult] = useState<LayoutResult | null>(null);

  useEffect(() => {
    let cancelled = false;

    toReactFlowElements(buildPlanGraph(plan)).then((layout) => {
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
