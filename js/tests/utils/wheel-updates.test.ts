import { describe, expect, test } from "bun:test";
import fixture from "../../../fixtures/wheel-update-cases.json";
import type { ChangeDesc } from "../../src/types/plan-schema.ts";
import {
  classifyWheelUpdate,
  parseWheelFilename,
  type WheelUpdate,
} from "../../src/utils/wheel-updates.ts";

type FixtureCase = {
  readonly name: string;
  readonly changeKey: string;
  readonly resourceType?: string;
  readonly old?: string;
  readonly new?: string;
  readonly expected: WheelUpdate | null;
};

describe("classifyWheelUpdate (shared fixture — keeps TS + Python in lockstep)", () => {
  for (const rawCase of fixture.cases as readonly FixtureCase[]) {
    test(rawCase.name, () => {
      const change: ChangeDesc = { action: "update", old: rawCase.old, new: rawCase.new };

      const result = classifyWheelUpdate(rawCase.changeKey, change, rawCase.resourceType) ?? null;

      const expected =
        rawCase.expected === null
          ? null
          : { ...rawCase.expected, oldRequirement: rawCase.old, newRequirement: rawCase.new };
      expect(result).toEqual(expected);
    });
  }
});

describe("parseWheelFilename", () => {
  test("standard tags", () => {
    expect(parseWheelFilename("/a/b/etl_lib-0.1.0-py3-none-any.whl")).toEqual({
      distribution: "etl_lib",
      version: "0.1.0",
    });
  });

  test("build tag", () => {
    expect(parseWheelFilename("model_lib-2.0.0-1-py3-none-any.whl")).toEqual({
      distribution: "model_lib",
      version: "2.0.0",
    });
  });

  test("pip extras", () => {
    expect(
      parseWheelFilename("/Workspace/artifacts/etl_lib-0.1.0-py3-none-any.whl[train,gpu]"),
    ).toEqual({
      distribution: "etl_lib",
      version: "0.1.0",
    });
  });

  test("malformed pip extras return undefined", () => {
    expect(parseWheelFilename("etl_lib-0.1.0-py3-none-any.whl[train,]")).toBeUndefined();
  });

  test("too few segments returns undefined", () => {
    expect(parseWheelFilename("/wheels/bundle.whl")).toBeUndefined();
  });

  test("non-whl extension returns undefined", () => {
    expect(parseWheelFilename("/jars/etl_lib-0.1.0-py3-none-any.jar")).toBeUndefined();
  });
});
