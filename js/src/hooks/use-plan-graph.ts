import { buildPlanGraph } from "../graph/build-plan-graph.ts";
import { toReactFlowElements } from "../graph/layout-graph.ts";
import type { Plan } from "../types/plan-schema.ts";
import { type GraphLayoutState, useAsyncLayout } from "./use-async-layout.ts";

export type { GraphLayoutState };

const transformPlanLayout = (plan: Plan) => toReactFlowElements(buildPlanGraph(plan));

/** Async transformation of Plan → React Flow nodes and edges. */
export const usePlanGraph = (plan: Plan): GraphLayoutState =>
  useAsyncLayout(plan, transformPlanLayout);
