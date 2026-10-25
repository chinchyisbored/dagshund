import { type ContextType, createElement, type ReactNode } from "react";
import {
  InteractionContext,
  JobNavigationContext,
  LateralIsolationContext,
  PlanContext,
  TabVisibilityContext,
} from "../../src/hooks/contexts.ts";
import { ValueFormatContext } from "../../src/hooks/use-value-format.ts";
import type { Plan } from "../../src/types/plan-schema.ts";
import type { ValueFormat } from "../../src/utils/format-value.ts";

// Small composable wrapper factories for React context providers — each test
// names exactly the contexts it depends on. Prefer this over a monolithic
// AllProviders to keep intent visible.

export type Wrapper = (props: { readonly children: ReactNode }) => ReactNode;

type InteractionState = ContextType<typeof InteractionContext>;

const defaultInteractionState: InteractionState = {
  hoveredNodeId: null,
  selectedNodeId: null,
  connectedIds: null,
  selectedConnectedIds: null,
  filterMatchedIds: null,
  lateralHandlesByNode: null,
  isolatedLateralIds: null,
  lateralNodeIds: null,
  isolatedLateralNodeId: null,
  showLateralEdges: false,
};

export const withInteractionState =
  (overrides: Partial<InteractionState> = {}): Wrapper =>
  ({ children }) =>
    createElement(
      InteractionContext.Provider,
      { value: { ...defaultInteractionState, ...overrides } },
      children,
    );

export const withPlan =
  (plan?: Plan): Wrapper =>
  ({ children }) =>
    createElement(PlanContext.Provider, { value: plan }, children);

export const withValueFormat =
  (format: ValueFormat = "json"): Wrapper =>
  ({ children }) =>
    createElement(ValueFormatContext.Provider, { value: format }, children);

export const withTabVisibility =
  (visible = true): Wrapper =>
  ({ children }) =>
    createElement(TabVisibilityContext.Provider, { value: visible }, children);

export const withJobNavigation =
  (handler: ((jobResourceKey: string) => void) | null = null): Wrapper =>
  ({ children }) =>
    createElement(JobNavigationContext.Provider, { value: handler }, children);

export const withLateralIsolation =
  (handler: ((nodeId: string) => void) | null = null): Wrapper =>
  ({ children }) =>
    createElement(LateralIsolationContext.Provider, { value: handler }, children);

/** Compose wrappers outer-to-inner: `compose(a, b)` renders `<a><b>{children}</b></a>`. */
export const compose =
  (...wrappers: readonly Wrapper[]): Wrapper =>
  ({ children }) =>
    wrappers.reduceRight<ReactNode>((acc, wrapper) => wrapper({ children: acc }), children);
