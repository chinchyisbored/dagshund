import { useMemo } from "react";
import type { Plan } from "../types/plan-schema.ts";
import { buildPlanGraph } from "../graph/build-plan-graph.ts";
import { toReactFlowElements } from "../graph/layout-graph.ts";

/** Memoized transformation of Plan → React Flow nodes and edges. */
export const usePlanGraph = (plan: Plan) =>
  useMemo(() => toReactFlowElements(buildPlanGraph(plan)), [plan]);
