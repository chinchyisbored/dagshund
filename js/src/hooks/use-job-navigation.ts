import { createContext, useContext } from "react";

/** Callback to navigate from a resource-graph job node to the Jobs tab. */
export type JobNavigationHandler = (jobResourceKey: string) => void;

export const JobNavigationContext = createContext<JobNavigationHandler | null>(null);

/** Returns the job navigation callback, or null if not inside a provider. */
export const useJobNavigation = (): JobNavigationHandler | null => useContext(JobNavigationContext);
