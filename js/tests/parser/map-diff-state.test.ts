import { describe, expect, test } from "bun:test";
import { mapActionToDiffState } from "../../src/parser/map-diff-state.ts";

describe("mapActionToDiffState", () => {
  test("maps 'create' to 'added'", () => {
    expect(mapActionToDiffState("create")).toBe("added");
  });

  test("maps 'delete' to 'removed'", () => {
    expect(mapActionToDiffState("delete")).toBe("removed");
  });

  test("maps 'update' to 'modified'", () => {
    expect(mapActionToDiffState("update")).toBe("modified");
  });

  test("maps 'resize' to 'modified'", () => {
    expect(mapActionToDiffState("resize")).toBe("modified");
  });

  test("maps 'recreate' to 'modified'", () => {
    expect(mapActionToDiffState("recreate")).toBe("modified");
  });

  test("maps 'update_id' to 'modified'", () => {
    expect(mapActionToDiffState("update_id")).toBe("modified");
  });

  test("maps 'skip' to 'unchanged'", () => {
    expect(mapActionToDiffState("skip")).toBe("unchanged");
  });

  test("maps empty string to 'unchanged'", () => {
    expect(mapActionToDiffState("")).toBe("unchanged");
  });

  test("maps 'unknown' to 'unknown'", () => {
    expect(mapActionToDiffState("unknown")).toBe("unknown");
  });

  test("maps undefined to 'unchanged'", () => {
    expect(mapActionToDiffState(undefined)).toBe("unchanged");
  });
});
