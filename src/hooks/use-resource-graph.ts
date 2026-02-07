import type { Edge, Node } from "@xyflow/react";
import { useEffect, useState } from "react";
import { buildResourceGraph } from "../graph/build-resource-graph.ts";
import { layoutResourceGraph } from "../graph/layout-graph.ts";
import type { Plan } from "../types/plan-schema.ts";

type LayoutResult = {
  readonly nodes: readonly Node[];
  readonly edges: readonly Edge[];
};

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
