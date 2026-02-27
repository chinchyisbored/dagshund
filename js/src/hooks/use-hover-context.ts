import { createContext, useContext } from "react";

type HoverState = {
  readonly hoveredNodeId: string | null;
  readonly selectedNodeId: string | null;
  readonly connectedIds: ReadonlySet<string> | null;
  readonly selectedConnectedIds: ReadonlySet<string> | null;
  readonly filterMatchedIds: ReadonlySet<string> | null;
  readonly lateralHandlesByNode: ReadonlyMap<string, ReadonlySet<string>> | null;
  readonly lateralIsolatedIds: ReadonlySet<string> | null;
  readonly lateralNodeIds: ReadonlySet<string> | null;
  readonly isolatedLateralNodeId: string | null;
};

export const HoverContext = createContext<HoverState>({
  hoveredNodeId: null,
  selectedNodeId: null,
  connectedIds: null,
  selectedConnectedIds: null,
  filterMatchedIds: null,
  lateralHandlesByNode: null,
  lateralIsolatedIds: null,
  lateralNodeIds: null,
  isolatedLateralNodeId: null,
});

/** Read the current hover-dimming state from the nearest HoverContext provider. */
export const useHoverState = (): HoverState => useContext(HoverContext);
