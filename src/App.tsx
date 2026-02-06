import { Background, Controls, type DefaultEdgeOptions, MiniMap, ReactFlow } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import "./styles/output.css";

import mixedPlanFixture from "../tests/fixtures/mixed-plan.json";
import { JobNode } from "./components/job-node.tsx";
import { TaskNode } from "./components/task-node.tsx";
import { usePlanGraph } from "./hooks/use-plan-graph.ts";
import { parsePlanJson } from "./parser/parse-plan.ts";

const parsedResult = parsePlanJson(mixedPlanFixture);
if (!parsedResult.ok) {
  throw new Error(`Failed to parse dev fixture: ${parsedResult.error}`);
}
const DEV_PLAN = parsedResult.data;

const NODE_TYPES = { job: JobNode, task: TaskNode };

const DEFAULT_EDGE_OPTIONS: DefaultEdgeOptions = {
  style: { stroke: "#71717a" },
};

export function App() {
  const { nodes, edges } = usePlanGraph(DEV_PLAN);

  return (
    <div className="h-screen w-screen bg-zinc-950">
      <ReactFlow
        nodes={[...nodes]}
        edges={[...edges]}
        nodeTypes={NODE_TYPES}
        defaultEdgeOptions={DEFAULT_EDGE_OPTIONS}
        nodesConnectable={false}
        fitView
      >
        <Background />
        <Controls />
        <MiniMap style={{ backgroundColor: "#18181b" }} />
      </ReactFlow>
    </div>
  );
}
