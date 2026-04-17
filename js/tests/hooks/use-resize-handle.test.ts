import { afterEach, describe, expect, test } from "bun:test";
import { act, renderHook } from "@testing-library/react";
import { useResizeHandle } from "../../src/hooks/use-resize-handle.ts";

// Minimal PointerEvent-ish object matching React.PointerEvent shape used by the hook.
// Only the fields the hook reads are populated; the cast keeps TS happy.
const makePointerEvent = (clientX: number): React.PointerEvent =>
  ({
    clientX,
    preventDefault: () => {},
  }) as unknown as React.PointerEvent;

const dispatchDocPointer = (type: "pointermove" | "pointerup", clientX: number): void => {
  // happy-dom supports PointerEvent; fall back to MouseEvent shape which shares clientX.
  const event = new Event(type) as Event & { clientX: number };
  Object.defineProperty(event, "clientX", { value: clientX });
  document.dispatchEvent(event);
};

afterEach(() => {
  document.body.style.cursor = "";
  document.body.style.userSelect = "";
});

describe("useResizeHandle", () => {
  test("defaults to 390 before any drag", () => {
    const { result } = renderHook(() => useResizeHandle());
    expect(result.current.width).toBe(390);
  });

  test("drag left (decreasing clientX) increases width; clamped to 600 max", () => {
    const { result } = renderHook(() => useResizeHandle());
    act(() => {
      result.current.handlePointerDown(makePointerEvent(500));
    });
    expect(document.body.style.cursor).toBe("col-resize");
    expect(document.body.style.userSelect).toBe("none");
    act(() => {
      dispatchDocPointer("pointermove", 100);
    });
    // delta = 100 - 500 = -400 → width = 390 - (-400) = 790 → clamped to 600
    expect(result.current.width).toBe(600);
    act(() => {
      dispatchDocPointer("pointerup", 100);
    });
    expect(document.body.style.cursor).toBe("");
    expect(document.body.style.userSelect).toBe("");
  });

  test("drag right (increasing clientX) decreases width; clamped to 300 min", () => {
    const { result } = renderHook(() => useResizeHandle());
    act(() => {
      result.current.handlePointerDown(makePointerEvent(0));
    });
    act(() => {
      dispatchDocPointer("pointermove", 500);
    });
    // delta = 500 → width = 390 - 500 = -110 → clamped to 300
    expect(result.current.width).toBe(300);
    act(() => {
      dispatchDocPointer("pointerup", 500);
    });
  });

  test("pointermove outside a drag is a no-op", () => {
    const { result } = renderHook(() => useResizeHandle());
    act(() => {
      dispatchDocPointer("pointermove", 1000);
    });
    expect(result.current.width).toBe(390);
  });
});
