import { useEffect, useState } from "react";
import type { LayoutResult } from "../types/layout-result.ts";
import type { Plan } from "../types/plan-schema.ts";

export type GraphLayoutState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly layout: LayoutResult }
  | { readonly status: "error"; readonly message: string };

/** Generic hook for async Plan → LayoutResult transformations with cancellation. */
export const useAsyncLayout = (
  plan: Plan,
  transformLayout: (plan: Plan) => Promise<LayoutResult>,
): GraphLayoutState => {
  const [state, setState] = useState<GraphLayoutState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });

    transformLayout(plan).then(
      (layout) => {
        if (!cancelled) setState({ status: "ready", layout });
      },
      (error: unknown) => {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : "Layout failed";
          setState({ status: "error", message });
        }
      },
    );

    return () => {
      cancelled = true;
    };
  }, [plan, transformLayout]);

  return state;
};
