import { useCallback, useMemo, useState } from "react";
import "@xyflow/react/dist/style.css";
import "./styles/output.css";

import { ErrorBoundary } from "./components/error-boundary.tsx";
import { FlowCanvas } from "./components/flow-canvas.tsx";
import { JobNode } from "./components/job-node.tsx";
import { PreparationDiagnostics } from "./components/preparation-diagnostics.tsx";
import { ProvenancePanel } from "./components/provenance-panel.tsx";
import { ResourcesView } from "./components/resources-view.tsx";
import { TabBar } from "./components/tab-bar.tsx";
import { TaskNode } from "./components/task-node.tsx";
import { ThemeToggle } from "./components/theme-toggle.tsx";
import { JobNavigationContext, PlanContext, TabVisibilityContext } from "./hooks/contexts.ts";
import { usePlanGraph } from "./hooks/use-plan-graph.ts";
import { useProvenance } from "./hooks/use-provenance.ts";
import { useStdinPlan } from "./hooks/use-stdin-plan.ts";
import { preparePlan } from "./preparation/prepare-plan.ts";
import type { Plan } from "./types/plan-schema.ts";
import type { PreparedPlan } from "./types/prepared-plan.ts";
import { classifyJobRunEffect } from "./utils/job-run-effects.ts";
import { type JobRunEffect, type NormalizedPlan, normalizePlan } from "./utils/normalize-plan.ts";
import { applyWheelSuppression, type WheelUsage } from "./utils/wheel-suppression.ts";
import { formatWheelUpdate } from "./utils/wheel-updates.ts";

/** Count plan entries by tab: jobs vs all resources (resources tab includes jobs).
 *  Effect entries (job_runs) are folded away by normalizePlan and never count. */
const countByTab = (plan: NormalizedPlan): Readonly<Record<"jobs" | "resources", number>> => {
  const keys = Object.keys(plan.entries);
  const jobs = keys.filter((key) => key.startsWith("resources.jobs.")).length;
  return { jobs, resources: keys.length };
};

const hasActiveEffect = (effect: JobRunEffect): boolean =>
  (effect.action !== "skip" && effect.action !== "") ||
  classifyJobRunEffect(effect).kind === "in-progress";

const NODE_TYPES = { job: JobNode, task: TaskNode };

function WheelUpdateSummary({
  usages,
  active,
}: {
  readonly usages: readonly WheelUsage[];
  readonly active: boolean;
}) {
  if (!active || usages.length === 0) return null;
  return (
    <section
      aria-label="Wheel updates"
      className="max-h-24 shrink-0 overflow-y-auto border-b border-outline bg-surface-raised px-4 py-2 text-xs text-ink-muted"
    >
      <h2 className="font-semibold text-ink">Wheel updates</h2>
      <ul className="flex flex-col gap-y-1">
        {usages.map((usage) => (
          <li
            key={`${usage.update.distribution}:${usage.update.oldRequirement}:${usage.update.newRequirement}`}
            className="break-all"
          >
            {formatWheelUpdate(
              usage.update,
              usages.map(({ update }) => update),
            )}
            {Object.entries({
              tasks: usage.taskCount,
              environments: usage.environmentCount,
              pipelines: usage.pipelineCount,
            })
              .filter(([, count]) => count > 0)
              .map(([category, count], index) => (
                <span key={category}>
                  {index === 0 ? " · " : ", "}
                  {count} {category}
                </span>
              ))}
          </li>
        ))}
      </ul>
    </section>
  );
}

type DagViewProps = {
  readonly plan: PreparedPlan;
  readonly hideWheelUpdates: boolean;
  readonly onToggleWheelUpdates: () => void;
  readonly wheelUpdateCount: number;
  readonly focusNodeId?: string | null;
  readonly onFocusComplete?: () => void;
};

function DagView({
  plan,
  hideWheelUpdates,
  onToggleWheelUpdates,
  wheelUpdateCount,
  focusNodeId,
  onFocusComplete,
}: DagViewProps) {
  const layoutState = usePlanGraph(plan);
  return (
    <FlowCanvas
      layoutState={layoutState}
      nodeTypes={NODE_TYPES}
      hideWheelUpdates={hideWheelUpdates}
      onToggleWheelUpdates={onToggleWheelUpdates}
      wheelUpdateCount={wheelUpdateCount}
      focusNodeId={focusNodeId}
      onFocusComplete={onFocusComplete}
      emptyLabel="No jobs in this plan"
    />
  );
}

function LoadingIndicator() {
  return (
    <div className="flex h-full items-center justify-center gap-3 text-ink-muted">
      <div className="h-3 w-3 animate-pulse rounded-full bg-ink-muted" />
      <span>Loading plan…</span>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-ink-muted">
      <p className="text-lg">No plan loaded</p>
      <p className="text-sm text-ink-faint">Pipe a plan to get started:</p>
      <code className="rounded bg-code-bg px-3 py-1.5 text-sm text-ink-muted">
        databricks bundle plan -o json | dagshund
      </code>
    </div>
  );
}

function ErrorMessage({ message }: { readonly message: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-danger">
      <p className="text-lg">Failed to load plan</p>
      <code className="max-w-lg rounded bg-code-bg px-3 py-1.5 text-sm text-danger">{message}</code>
      <p className="max-w-lg text-center text-sm text-ink-muted">
        Ensure your plan was generated with a compatible version of{" "}
        <code className="rounded bg-code-bg px-1.5 py-0.5 text-xs">
          databricks bundle plan -o json
        </code>
      </p>
    </div>
  );
}

function PlanView({ plan }: { readonly plan: Plan }) {
  const normalizedPlan = useMemo(() => normalizePlan(plan.plan ?? {}), [plan]);
  const wheelSuppression = useMemo(() => applyWheelSuppression(normalizedPlan), [normalizedPlan]);
  const [hideWheelUpdates, setHideWheelUpdates] = useState(false);
  const effectivePlan = hideWheelUpdates ? wheelSuppression.plan : normalizedPlan;
  const preparedPlan = useMemo(() => preparePlan(effectivePlan), [effectivePlan]);
  const wheelUpdateCount = wheelSuppression.usages.reduce(
    (count, usage) => count + usage.taskCount + usage.environmentCount + usage.pipelineCount,
    0,
  );
  const hasEffectiveChanges = Object.values(effectivePlan.entries).some(
    (entry) =>
      (entry.action !== undefined && entry.action !== "skip" && entry.action !== "") ||
      entry.effects?.some(hasActiveEffect) === true,
  );
  const hasOrphanEffects = effectivePlan.orphanEffects.some(({ effects }) =>
    effects.some(hasActiveEffect),
  );
  const handleToggleWheelUpdates = useCallback(() => setHideWheelUpdates((hidden) => !hidden), []);
  const [activeTab, setActiveTab] = useState<"jobs" | "resources">("resources");
  const [focusJobId, setFocusJobId] = useState<string | null>(null);
  const tabCounts = useMemo(() => countByTab(normalizedPlan), [normalizedPlan]);

  const handleNavigateToJob = useCallback((jobResourceKey: string) => {
    setActiveTab("jobs");
    setFocusJobId(jobResourceKey);
  }, []);

  const handleFocusComplete = useCallback(() => {
    setFocusJobId(null);
  }, []);

  return (
    <PlanContext.Provider value={plan}>
      <div className="flex h-full flex-col">
        <TabBar activeTab={activeTab} onTabChange={setActiveTab} counts={tabCounts} />
        <PreparationDiagnostics diagnostics={preparedPlan.diagnostics} />
        <WheelUpdateSummary usages={wheelSuppression.usages} active={hideWheelUpdates} />
        {!hasEffectiveChanges && !hasOrphanEffects && (
          <p role="status" className="shrink-0 px-4 py-2 text-sm text-ink-muted">
            {hideWheelUpdates && wheelSuppression.usages.length > 0
              ? "No non-wheel changes"
              : "No changes"}
          </p>
        )}
        <div className="min-h-0 flex-1">
          <div className="h-full" style={activeTab !== "jobs" ? { display: "none" } : undefined}>
            <ErrorBoundary>
              <TabVisibilityContext.Provider value={activeTab === "jobs"}>
                <DagView
                  plan={preparedPlan}
                  hideWheelUpdates={hideWheelUpdates}
                  onToggleWheelUpdates={handleToggleWheelUpdates}
                  wheelUpdateCount={wheelUpdateCount}
                  focusNodeId={focusJobId}
                  onFocusComplete={handleFocusComplete}
                />
              </TabVisibilityContext.Provider>
            </ErrorBoundary>
          </div>
          <div
            className="h-full"
            style={activeTab !== "resources" ? { display: "none" } : undefined}
          >
            <ErrorBoundary>
              <TabVisibilityContext.Provider value={activeTab === "resources"}>
                <JobNavigationContext.Provider value={handleNavigateToJob}>
                  <ResourcesView
                    plan={preparedPlan}
                    hideWheelUpdates={hideWheelUpdates}
                    onToggleWheelUpdates={handleToggleWheelUpdates}
                    wheelUpdateCount={wheelUpdateCount}
                  />
                </JobNavigationContext.Provider>
              </TabVisibilityContext.Provider>
            </ErrorBoundary>
          </div>
        </div>
      </div>
    </PlanContext.Provider>
  );
}

export function App() {
  const planState = useStdinPlan();
  const provenance = useProvenance();

  return (
    <div className="relative h-screen w-screen bg-surface">
      <div className="absolute top-2 right-2 z-50 flex items-center gap-0.5">
        <ProvenancePanel provenance={provenance} />
        <ThemeToggle />
      </div>
      {planState.status === "loading" && <LoadingIndicator />}
      {planState.status === "empty" && <EmptyState />}
      {planState.status === "error" && <ErrorMessage message={planState.message} />}
      {planState.status === "ready" && <PlanView plan={planState.plan} />}
    </div>
  );
}
