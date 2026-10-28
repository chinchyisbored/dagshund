import { describe, expect, test } from "bun:test";
import {
  getFirstJobBlockAnchor,
  stackJobDependencyBlocks,
} from "../../src/graph/job-dependency-blocks.ts";
import { buildGraphEdge } from "../../src/types/graph-types.ts";

describe("getFirstJobBlockAnchor", () => {
  test("uses the full first block bounds when its topmost job is not leftmost", () => {
    const jobs = [
      { id: "alpha", name: "alpha_start" },
      { id: "beta", name: "beta_branch" },
      { id: "independent", name: "zulu" },
    ];
    const edges = [{ source: "alpha::task", target: "beta::task" }];
    const positions = new Map([
      ["alpha", { x: 0, y: 8 }],
      ["beta", { x: 340, y: 0 }],
      ["independent", { x: 0, y: 400 }],
    ]);
    const anchor = getFirstJobBlockAnchor(jobs, edges, positions);

    expect(anchor).toEqual({ x: 0, y: 0 });
  });
});

describe("stackJobDependencyBlocks", () => {
  test("handles empty and singleton inputs without changing positions", () => {
    const positions = new Map([["alone", { x: -12, y: 30 }]]);
    const dimensions = new Map([["alone", { width: 220, height: 56 }]]);

    expect(stackJobDependencyBlocks([], [], positions, dimensions)).toEqual(positions);
    expect(
      stackJobDependencyBlocks([{ id: "alone", name: "Standalone" }], [], positions, dimensions),
    ).toEqual(new Map([["alone", { x: 0, y: 0 }]]));
    expect(positions.get("alone")).toEqual({ x: -12, y: 30 });
  });

  test("orders by the earliest visible starting job, then stable job ID", () => {
    const jobs = [
      { id: "z-start", name: "Zulu start" },
      { id: "a-start", name: "Alpha start" },
      { id: "b-start", name: "Alpha start" },
      { id: "downstream", name: "Aardvark downstream" },
      { id: "equal-z", name: "Equal start" },
      { id: "equal-a", name: "Equal start" },
    ];
    const edges = [
      { source: "a-start::task", target: "downstream::task" },
      { source: "b-start::task", target: "downstream::task" },
    ];
    const positions = new Map(jobs.map(({ id }, index) => [id, { x: index * 50, y: index * 100 }]));
    const dimensions = new Map(jobs.map(({ id }) => [id, { width: 100, height: 40 }]));

    const result = stackJobDependencyBlocks(jobs, edges, positions, dimensions, 60);

    expect(result.get("a-start")?.y).toBe(0);
    expect(result.get("b-start")?.y).toBe(100);
    expect(result.get("downstream")?.y).toBe(200);
    expect(result.get("equal-a")?.y).toBe(300);
    expect(result.get("equal-z")?.y).toBe(400);
    expect(result.get("z-start")?.y).toBe(500);
  });

  test("uses deduplicated added and removed cross-job relationships for block membership", () => {
    const jobs = [
      { id: "first", name: "First" },
      { id: "middle", name: "Middle" },
      { id: "last", name: "Last" },
      { id: "independent", name: "Independent" },
    ];
    const edges = [
      { ...buildGraphEdge("first::task-a", "middle::task-a", "added") },
      { ...buildGraphEdge("first::task-b", "middle::task-b", "removed") },
      { ...buildGraphEdge("middle::task", "last::task", "unchanged") },
    ];
    const positions = new Map(
      jobs.map(({ id }, index) => [id, { x: index * 100, y: index * 150 }]),
    );
    const dimensions = new Map(jobs.map(({ id }) => [id, { width: 100, height: 80 }]));

    const result = stackJobDependencyBlocks(jobs, edges, positions, dimensions, 60);

    expect(result.get("first")).toEqual({ x: 0, y: 0 });
    expect(result.get("middle")).toEqual({ x: 100, y: 150 });
    expect(result.get("last")).toEqual({ x: 200, y: 300 });
    expect(result.get("independent")).toEqual({ x: 0, y: 440 });
  });

  test("uses negative origins and the full block height for exact spacing", () => {
    const jobs = [
      { id: "start", name: "Alpha" },
      { id: "tall", name: "Tall downstream" },
      { id: "next", name: "Beta" },
    ];
    const edges = [{ source: "start::task", target: "tall::task" }];
    const positions = new Map([
      ["start", { x: -80, y: -40 }],
      ["tall", { x: 200, y: 10 }],
      ["next", { x: -300, y: -500 }],
      ["start::task", { x: -60, y: 8 }],
    ]);
    const dimensions = new Map([
      ["start", { width: 220, height: 100 }],
      ["tall", { width: 220, height: 300 }],
      ["next", { width: 220, height: 56 }],
    ]);

    const result = stackJobDependencyBlocks(jobs, edges, positions, dimensions, 60);

    expect(result.get("start")).toEqual({ x: 0, y: 0 });
    expect(result.get("tall")).toEqual({ x: 280, y: 50 });
    expect(result.get("next")).toEqual({ x: 0, y: 410 });
    expect(result.get("start::task")).toEqual({ x: -60, y: 8 });
    expect(positions.get("start")).toEqual({ x: -80, y: -40 });
  });
  test("aligns and vertically separates connected blocks ordered by visible start name", () => {
    const jobs = [
      { id: "j-z", name: "zulu" },
      { id: "j-b", name: "beta" },
      { id: "j-a", name: "alpha" },
      { id: "j-c", name: "later" },
      { id: "j-alone", name: "independent" },
    ];
    const edges = [
      { source: "j-a::task", target: "j-c::task" },
      { source: "j-b::task", target: "j-c::task" },
      { source: "j-z::task", target: "j-z::other" },
    ];
    const positions = new Map([
      ["j-z", { x: 300, y: 10 }],
      ["j-b", { x: 500, y: 200 }],
      ["j-a", { x: 400, y: 250 }],
      ["j-c", { x: 700, y: 400 }],
      ["j-alone", { x: 100, y: 50 }],
      ["j-a::task", { x: 20, y: 30 }],
    ]);
    const dimensions = new Map(
      jobs.map(({ id }) => [id, { width: 200, height: id === "j-c" ? 300 : 100 }]),
    );

    const result = stackJobDependencyBlocks(jobs, edges, positions, dimensions, 60);

    expect(result.get("j-a")).toEqual({ x: 0, y: 50 });
    expect(result.get("j-b")).toEqual({ x: 100, y: 0 });
    expect(result.get("j-c")).toEqual({ x: 300, y: 200 });
    expect(result.get("j-alone")).toEqual({ x: 0, y: 560 });
    expect(result.get("j-z")).toEqual({ x: 0, y: 720 });
    expect(result.get("j-a::task")).toEqual(positions.get("j-a::task"));
    expect(positions.get("j-a")).toEqual({ x: 400, y: 250 });
  });

  test("preserves the ELK layout when a component has no starting job", () => {
    const positions = new Map([
      ["j-a", { x: 10, y: 20 }],
      ["j-b", { x: 30, y: 40 }],
    ]);
    const jobs = [
      { id: "j-a", name: "a" },
      { id: "j-b", name: "b" },
    ];
    const edges = [
      { source: "j-a::task", target: "j-b::task" },
      { source: "j-b::task", target: "j-a::task" },
    ];
    const dimensions = new Map(jobs.map(({ id }) => [id, { width: 100, height: 100 }]));

    const result = stackJobDependencyBlocks(jobs, edges, positions, dimensions);

    expect(result).toBe(positions);
  });
});
