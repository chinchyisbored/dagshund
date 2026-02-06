import { ReactFlow, Background, Controls, MiniMap } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import "./styles/output.css";

const EMPTY_NODES: readonly never[] = [];
const EMPTY_EDGES: readonly never[] = [];

export function App() {
  return (
    <div className="h-screen w-screen bg-zinc-950">
      <ReactFlow
        nodes={[...EMPTY_NODES]}
        edges={[...EMPTY_EDGES]}
        fitView
      >
        <Background />
        <Controls />
        <MiniMap />
      </ReactFlow>
    </div>
  );
}
