import { createContext, useContext } from "react";

type HoverState = {
  readonly connectedIds: ReadonlySet<string> | null;
  readonly filterMatchedIds: ReadonlySet<string> | null;
};

export const HoverContext = createContext<HoverState>({
  connectedIds: null,
  filterMatchedIds: null,
});

/** Read the current hover-dimming state from the nearest HoverContext provider. */
export const useHoverState = (): HoverState => useContext(HoverContext);
