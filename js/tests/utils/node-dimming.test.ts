import { describe, expect, test } from "bun:test";
import { buildGlowStyle } from "../../src/utils/node-dimming.ts";

describe("buildGlowStyle", () => {
  const glow = "rgba(0, 100, 255, 0.6)";

  test("selected node gets 2.5px boxShadow", () => {
    const style = buildGlowStyle(true, false, false, 1, glow);
    expect(style.boxShadow).toBe(`0 0 0 2.5px ${glow}`);
    expect(style.opacity).toBeUndefined();
  });

  test("hovered node gets 1.5px boxShadow", () => {
    const style = buildGlowStyle(false, true, false, 1, glow);
    expect(style.boxShadow).toBe(`0 0 0 1.5px ${glow}`);
  });

  test("selected takes priority over hovered", () => {
    const style = buildGlowStyle(true, true, false, 1, glow);
    expect(style.boxShadow).toBe(`0 0 0 2.5px ${glow}`);
  });

  test("dimmed node gets opacity", () => {
    const style = buildGlowStyle(false, false, true, 0.3, glow);
    expect(style.opacity).toBe(0.3);
    expect(style.boxShadow).toBeUndefined();
  });

  test("dimmed and selected gets both boxShadow and opacity", () => {
    const style = buildGlowStyle(true, false, true, 0.5, glow);
    expect(style.boxShadow).toBe(`0 0 0 2.5px ${glow}`);
    expect(style.opacity).toBe(0.5);
  });

  test("no interaction produces empty style", () => {
    const style = buildGlowStyle(false, false, false, 1, glow);
    expect(style.boxShadow).toBeUndefined();
    expect(style.opacity).toBeUndefined();
  });
});
