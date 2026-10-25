import { buildPlanGraph } from "../../src/graph/build-plan-graph.ts";
import { buildResourceGraph } from "../../src/graph/build-resource-graph.ts";
import { preparePlan } from "../../src/preparation/prepare-plan.ts";
import type { Plan } from "../../src/types/plan-schema.ts";
import { normalizePlan } from "../../src/utils/normalize-plan.ts";

export const buildPlanGraphFromPlan = (plan: Plan) =>
  buildPlanGraph(preparePlan(normalizePlan(plan.plan ?? {})));

export const buildResourceGraphFromPlan = (plan: Plan) =>
  buildResourceGraph(preparePlan(normalizePlan(plan.plan ?? {})));
