import { createContext, useContext } from "react";

export const TabVisibilityContext = createContext(true);

/** Returns whether the current tab is visible. Defaults to true outside a provider. */
export const useTabVisibility = (): boolean => useContext(TabVisibilityContext);
