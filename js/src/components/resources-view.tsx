import { useResourceGraph } from "../hooks/use-resource-graph.ts";
import type { Plan } from "../types/plan-schema.ts";
import { FlowCanvas } from "./flow-canvas.tsx";
import { ResourceGroupNode } from "./resource-group-node.tsx";
import { ResourceNode } from "./resource-node.tsx";

const NODE_TYPES = { resource: ResourceNode, "resource-group": ResourceGroupNode };

export function ResourcesView({ plan }: { readonly plan: Plan }) {
  const layoutState = useResourceGraph(plan);
  return <FlowCanvas layoutState={layoutState} nodeTypes={NODE_TYPES} />;
}
