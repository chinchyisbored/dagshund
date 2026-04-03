import { createContext, useContext } from "react";
import type { Plan } from "../types/plan-schema.ts";

export const PlanContext = createContext<Plan | undefined>(undefined);

/** Read the original (pre-merge) plan from the nearest PlanContext provider. */
export const usePlan = (): Plan | undefined => useContext(PlanContext);
