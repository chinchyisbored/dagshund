import { FlowCanvas } from "./flow-canvas.tsx";
import { ResourceGroupNode } from "./resource-group-node.tsx";
import { ResourceNode } from "./resource-node.tsx";
import { useResourceGraph } from "../hooks/use-resource-graph.ts";
import type { Plan } from "../types/plan-schema.ts";

const NODE_TYPES = { resource: ResourceNode, "resource-group": ResourceGroupNode };

export function ResourcesView({ plan }: { readonly plan: Plan }) {
  const layout = useResourceGraph(plan);
  return <FlowCanvas layout={layout} nodeTypes={NODE_TYPES} />;
}
