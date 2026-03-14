import { Handle, Position } from "@xyflow/react";
import { memo } from "react";
import {
  LATERAL_BOTTOM,
  LATERAL_BOTTOM_OUT,
  LATERAL_HANDLE_HIDDEN_STYLE,
  LATERAL_HANDLE_STYLE,
  LATERAL_TOP,
  LATERAL_TOP_OUT,
} from "../utils/diff-state-styles.ts";

type LateralHandlesProps = {
  readonly lateralHandles: ReadonlySet<string> | undefined;
};

export const LateralHandles = memo(function LateralHandles({
  lateralHandles,
}: LateralHandlesProps) {
  const styleFor = (handleId: string) =>
    lateralHandles?.has(handleId) ? LATERAL_HANDLE_STYLE : LATERAL_HANDLE_HIDDEN_STYLE;

  return (
    <>
      <Handle
        type="target"
        position={Position.Top}
        id={LATERAL_TOP}
        style={styleFor(LATERAL_TOP)}
      />
      <Handle
        type="source"
        position={Position.Top}
        id={LATERAL_TOP_OUT}
        style={styleFor(LATERAL_TOP_OUT)}
      />
      <Handle
        type="target"
        position={Position.Bottom}
        id={LATERAL_BOTTOM}
        style={styleFor(LATERAL_BOTTOM)}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id={LATERAL_BOTTOM_OUT}
        style={styleFor(LATERAL_BOTTOM_OUT)}
      />
    </>
  );
});
