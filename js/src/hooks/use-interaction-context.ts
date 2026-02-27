import { createContext, useContext } from "react";

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
});

/** Read the current interaction state from the nearest InteractionContext provider. */
export const useInteractionState = (): InteractionState => useContext(InteractionContext);
