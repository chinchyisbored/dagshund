import { createContext, useContext } from "react";

export const LateralIsolationContext = createContext<((nodeId: string) => void) | null>(null);

/** Returns the lateral isolation toggle callback, or null if not inside a provider. */
export const useLateralIsolation = () => useContext(LateralIsolationContext);
