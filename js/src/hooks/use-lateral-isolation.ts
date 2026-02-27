import { createContext, useContext } from "react";

/** Callback to toggle lateral-edge isolation for a specific node. */
export type LateralIsolationHandler = (nodeId: string) => void;

export const LateralIsolationContext = createContext<LateralIsolationHandler | null>(null);

/** Returns the lateral isolation toggle callback, or null if not inside a provider. */
export const useLateralIsolation = (): LateralIsolationHandler | null =>
  useContext(LateralIsolationContext);
