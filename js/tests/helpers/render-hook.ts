import { createElement, type FunctionComponent } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * Minimal renderHook for Bun tests — no @testing-library dependency.
 * Renders a throwaway component that calls the hook and captures its return value.
 * Works because useMemo runs synchronously during server-side rendering.
 */
export const renderHook = <T>(hook: () => T): T => {
  let result: T | undefined;
  const Capture: FunctionComponent = () => {
    result = hook();
    return null;
  };
  renderToStaticMarkup(createElement(Capture));
  // as: renderToStaticMarkup is synchronous — result is always assigned before this line
  return result as T;
};
