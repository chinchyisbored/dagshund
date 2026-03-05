import { useResourceGraph } from "../hooks/use-resource-graph.ts";
import type { Plan } from "../types/plan-schema.ts";
import { FlowCanvas } from "./flow-canvas.tsx";
import { HierarchyNode } from "./hierarchy-node.tsx";
import { ResourceNode } from "./resource-node.tsx";

const NODE_TYPES = { resource: ResourceNode, root: HierarchyNode, phantom: HierarchyNode };

export function ResourcesView({
  plan,
  isVisible,
}: {
  readonly plan: Plan;
  readonly isVisible?: boolean;
}) {
  const layoutState = useResourceGraph(plan);
  return (
    <FlowCanvas
      layoutState={layoutState}
      nodeTypes={NODE_TYPES}
      emptyLabel="No resources in this plan"
      isVisible={isVisible}
    />
  );
}
