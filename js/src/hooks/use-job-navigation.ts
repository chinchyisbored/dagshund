import { createContext, useContext } from "react";

export const JobNavigationContext = createContext<((jobResourceKey: string) => void) | null>(null);

/** Returns the job navigation callback, or null if not inside a provider. */
export const useJobNavigation = () => useContext(JobNavigationContext);
