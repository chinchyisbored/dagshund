import { createContext, useContext } from "react";

type HoverState = {
  readonly hoveredNodeId: string | null;
  readonly selectedNodeId: string | null;
  readonly connectedIds: ReadonlySet<string> | null;
  readonly selectedConnectedIds: ReadonlySet<string> | null;
  readonly filterMatchedIds: ReadonlySet<string> | null;
};

export const HoverContext = createContext<HoverState>({
  hoveredNodeId: null,
  selectedNodeId: null,
  connectedIds: null,
  selectedConnectedIds: null,
  filterMatchedIds: null,
});

/** Read the current hover-dimming state from the nearest HoverContext provider. */
export const useHoverState = (): HoverState => useContext(HoverContext);
