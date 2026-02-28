import { buildResourceGraph } from "../graph/build-resource-graph.ts";
import { layoutResourceGraph } from "../graph/layout-graph.ts";
import type { Plan } from "../types/plan-schema.ts";
import type { GraphLayoutState } from "./use-async-layout.ts";
import { useAsyncLayout } from "./use-async-layout.ts";

const transformResourceLayout = (plan: Plan) => layoutResourceGraph(buildResourceGraph(plan));

/** Async transformation of Plan → React Flow nodes and edges for non-job resources. */
export const useResourceGraph = (plan: Plan): GraphLayoutState =>
  useAsyncLayout(plan, transformResourceLayout);
