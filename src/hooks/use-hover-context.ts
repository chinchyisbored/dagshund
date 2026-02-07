import { createContext, useContext } from "react";

type HoverState = {
  readonly connectedIds: ReadonlySet<string> | null;
};

export const HoverContext = createContext<HoverState>({ connectedIds: null });

/** Read the current hover-dimming state from the nearest HoverContext provider. */
export const useHoverState = (): HoverState => useContext(HoverContext);
