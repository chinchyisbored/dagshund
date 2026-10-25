import { useResourceGraph } from "../hooks/use-resource-graph.ts";
import type { PreparedPlan } from "../types/prepared-plan.ts";
import { FlowCanvas } from "./flow-canvas.tsx";
import { HierarchyNode } from "./hierarchy-node.tsx";
import { ResourceNode } from "./resource-node.tsx";

const NODE_TYPES = { resource: ResourceNode, root: HierarchyNode, phantom: HierarchyNode };

export function ResourcesView({
  plan,
  hideWheelUpdates,
  onToggleWheelUpdates,
  wheelUpdateCount,
}: {
  readonly plan: PreparedPlan;
  readonly hideWheelUpdates: boolean;
  readonly onToggleWheelUpdates: () => void;
  readonly wheelUpdateCount: number;
}) {
  const layoutState = useResourceGraph(plan);
  return (
    <FlowCanvas
      layoutState={layoutState}
      nodeTypes={NODE_TYPES}
      hideWheelUpdates={hideWheelUpdates}
      onToggleWheelUpdates={onToggleWheelUpdates}
      wheelUpdateCount={wheelUpdateCount}
      emptyLabel="No resources in this plan"
    />
  );
}
