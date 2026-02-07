import { useState } from "react";
import "@xyflow/react/dist/style.css";
import "./styles/output.css";

import { FlowCanvas } from "./components/flow-canvas.tsx";
import { JobNode } from "./components/job-node.tsx";
import { ResourcesView } from "./components/resources-view.tsx";
import { TabBar } from "./components/tab-bar.tsx";
import { TaskNode } from "./components/task-node.tsx";
import { hasNonJobResources } from "./graph/build-resource-graph.ts";
import { usePlanGraph } from "./hooks/use-plan-graph.ts";
import { useStdinPlan } from "./hooks/use-stdin-plan.ts";
import type { Plan } from "./types/plan-schema.ts";

const NODE_TYPES = { job: JobNode, task: TaskNode };

function DagView({ plan }: { readonly plan: Plan }) {
  const layout = usePlanGraph(plan);
  return <FlowCanvas layout={layout} nodeTypes={NODE_TYPES} />;
}

function LoadingIndicator() {
  return (
    <div className="flex h-full items-center justify-center text-zinc-500">Loading plan...</div>
  );
}

function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-zinc-500">
      <p className="text-lg">No plan loaded</p>
      <p className="text-sm text-zinc-600">Pipe a plan to get started:</p>
      <code className="rounded bg-zinc-800 px-3 py-1.5 text-sm text-zinc-400">
        databricks bundle plan -o json | dagshund
      </code>
    </div>
  );
}

function ErrorMessage({ message }: { readonly message: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-red-400">
      <p className="text-lg">Failed to load plan</p>
      <code className="max-w-lg rounded bg-zinc-800 px-3 py-1.5 text-sm text-red-300">
        {message}
      </code>
    </div>
  );
}

function PlanView({ plan }: { readonly plan: Plan }) {
  const showTabs = hasNonJobResources(plan);
  const [activeTab, setActiveTab] = useState<"jobs" | "resources">("jobs");

  if (!showTabs) {
    return <DagView plan={plan} />;
  }

  return (
    <div className="flex h-full flex-col">
      <TabBar activeTab={activeTab} onTabChange={setActiveTab} />
      <div className="min-h-0 flex-1">
        <div className="h-full" style={activeTab !== "jobs" ? { display: "none" } : undefined}>
          <DagView plan={plan} />
        </div>
        <div className="h-full" style={activeTab !== "resources" ? { display: "none" } : undefined}>
          <ResourcesView plan={plan} />
        </div>
      </div>
    </div>
  );
}

export function App() {
  const planState = useStdinPlan();

  return (
    <div className="h-screen w-screen bg-zinc-950">
      {planState.status === "loading" && <LoadingIndicator />}
      {planState.status === "empty" && <EmptyState />}
      {planState.status === "error" && <ErrorMessage message={planState.message} />}
      {planState.status === "ready" && <PlanView plan={planState.plan} />}
    </div>
  );
}
