import { buildPlanGraph } from "../graph/build-plan-graph.ts";
import { toReactFlowElements } from "../graph/layout-graph.ts";
import type { PreparedPlan } from "../types/prepared-plan.ts";
import { type GraphLayoutState, useAsyncLayout } from "./use-async-layout.ts";

export type { GraphLayoutState };

const transformPlanLayout = (plan: PreparedPlan) => toReactFlowElements(buildPlanGraph(plan));

/** Async transformation of a normalized plan → React Flow nodes and edges. */
export const usePlanGraph = (plan: PreparedPlan): GraphLayoutState =>
  useAsyncLayout(plan, transformPlanLayout);
