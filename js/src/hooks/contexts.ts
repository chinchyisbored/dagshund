import { createContext, useContext } from "react";
import type { Plan } from "../types/plan-schema.ts";

export const PlanContext = createContext<Plan | undefined>(undefined);

/** Read the original (pre-merge) plan from the nearest PlanContext provider. */
export const usePlan = (): Plan | undefined => useContext(PlanContext);

export const TabVisibilityContext = createContext(true);

/** Returns whether the current tab is visible. Defaults to true outside a provider. */
export const useTabVisibility = (): boolean => useContext(TabVisibilityContext);

export const JobNavigationContext = createContext<((jobResourceKey: string) => void) | null>(null);

/** Returns the job navigation callback, or null if not inside a provider. */
export const useJobNavigation = () => useContext(JobNavigationContext);

export const LateralIsolationContext = createContext<((nodeId: string) => void) | null>(null);

/** Returns the lateral isolation toggle callback, or null if not inside a provider. */
export const useLateralIsolation = () => useContext(LateralIsolationContext);

type InteractionState = {
  readonly hoveredNodeId: string | null;
  readonly selectedNodeId: string | null;
  readonly connectedIds: ReadonlySet<string> | null;
  readonly selectedConnectedIds: ReadonlySet<string> | null;
  readonly filterMatchedIds: ReadonlySet<string> | null;
  readonly lateralHandlesByNode: ReadonlyMap<string, ReadonlySet<string>> | null;
  readonly isolatedLateralIds: ReadonlySet<string> | null;
  readonly lateralNodeIds: ReadonlySet<string> | null;
  readonly isolatedLateralNodeId: string | null;
  readonly showLateralEdges: boolean;
};

export const InteractionContext = createContext<InteractionState>({
  hoveredNodeId: null,
  selectedNodeId: null,
  connectedIds: null,
  selectedConnectedIds: null,
  filterMatchedIds: null,
  lateralHandlesByNode: null,
  isolatedLateralIds: null,
  lateralNodeIds: null,
  isolatedLateralNodeId: null,
  showLateralEdges: false,
});

/** Read the current interaction state from the nearest InteractionContext provider. */
export const useInteractionState = (): InteractionState => useContext(InteractionContext);
