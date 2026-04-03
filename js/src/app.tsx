import { useCallback, useMemo, useState } from "react";
import "@xyflow/react/dist/style.css";
import "./styles/output.css";

import { ErrorBoundary } from "./components/error-boundary.tsx";
import { FlowCanvas } from "./components/flow-canvas.tsx";
import { JobNode } from "./components/job-node.tsx";
import { ResourcesView } from "./components/resources-view.tsx";
import { TabBar } from "./components/tab-bar.tsx";
import { TaskNode } from "./components/task-node.tsx";
import { ThemeToggle } from "./components/theme-toggle.tsx";
import { JobNavigationContext } from "./hooks/use-job-navigation.ts";
import { PlanContext } from "./hooks/use-plan-context.ts";
import { usePlanGraph } from "./hooks/use-plan-graph.ts";
import { useStdinPlan } from "./hooks/use-stdin-plan.ts";
import { TabVisibilityContext } from "./hooks/use-tab-visibility.ts";
import type { Plan } from "./types/plan-schema.ts";
import { mergeSubResources } from "./utils/merge-sub-resources.ts";

/** Count plan entries by tab: jobs vs all resources (resources tab includes jobs). */
const countByTab = (plan: Plan): Readonly<Record<"jobs" | "resources", number>> => {
  const keys = Object.keys(mergeSubResources(plan.plan ?? {}));
  const jobs = keys.filter((key) => key.startsWith("resources.jobs.")).length;
  return { jobs, resources: keys.length };
};

const NODE_TYPES = { job: JobNode, task: TaskNode };

type DagViewProps = {
  readonly plan: Plan;
  readonly focusNodeId?: string | null;
  readonly onFocusComplete?: () => void;
};

function DagView({ plan, focusNodeId, onFocusComplete }: DagViewProps) {
  const layoutState = usePlanGraph(plan);
  return (
    <FlowCanvas
      layoutState={layoutState}
      nodeTypes={NODE_TYPES}
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
  const [activeTab, setActiveTab] = useState<"jobs" | "resources">("resources");
  const [focusJobId, setFocusJobId] = useState<string | null>(null);
  const tabCounts = useMemo(() => countByTab(plan), [plan]);

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
        <div className="min-h-0 flex-1">
          <div className="h-full" style={activeTab !== "jobs" ? { display: "none" } : undefined}>
            <ErrorBoundary>
              <TabVisibilityContext.Provider value={activeTab === "jobs"}>
                <DagView
                  plan={plan}
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
                  <ResourcesView plan={plan} />
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

  return (
    <div className="relative h-screen w-screen bg-surface">
      <div className="absolute top-2 right-2 z-50">
        <ThemeToggle />
      </div>
      {planState.status === "loading" && <LoadingIndicator />}
      {planState.status === "empty" && <EmptyState />}
      {planState.status === "error" && <ErrorMessage message={planState.message} />}
      {planState.status === "ready" && <PlanView plan={planState.plan} />}
    </div>
  );
}
