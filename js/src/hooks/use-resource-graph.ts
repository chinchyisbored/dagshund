import { buildResourceGraph } from "../graph/build-resource-graph.ts";
import { layoutResourceGraph } from "../graph/layout-graph.ts";
import type { PreparedPlan } from "../types/prepared-plan.ts";
import type { GraphLayoutState } from "./use-async-layout.ts";
import { useAsyncLayout } from "./use-async-layout.ts";

const transformResourceLayout = (plan: PreparedPlan) =>
  layoutResourceGraph(buildResourceGraph(plan));

/** Async transformation of a normalized plan → React Flow nodes and edges for non-job resources. */
export const useResourceGraph = (plan: PreparedPlan): GraphLayoutState =>
  useAsyncLayout(plan, transformResourceLayout);
