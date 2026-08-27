import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { renderHook } from "@testing-library/react";
import { useProvenance } from "../../src/hooks/use-provenance.ts";
import { parseProvenanceJson } from "../../src/parser/parse-provenance.ts";
import type { Provenance } from "../../src/types/provenance-schema.ts";

const PROVENANCE_GLOBAL = "__DAGSHUND_PROVENANCE__";
const originalProvenanceDescriptor = Object.getOwnPropertyDescriptor(window, PROVENANCE_GLOBAL);
const originalConsoleError = console.error;
let consoleErrors: string[] = [];

const setEmbeddedProvenance = (value: unknown): void => {
  Object.defineProperty(window, PROVENANCE_GLOBAL, {
    configurable: true,
    value,
  });
};

beforeEach(() => {
  Reflect.deleteProperty(window, PROVENANCE_GLOBAL);
  consoleErrors = [];
  console.error = (...args: unknown[]) => {
    consoleErrors.push(args.map(String).join(" "));
  };
});

afterEach(() => {
  if (originalProvenanceDescriptor === undefined) {
    Reflect.deleteProperty(window, PROVENANCE_GLOBAL);
  } else {
    Object.defineProperty(window, PROVENANCE_GLOBAL, originalProvenanceDescriptor);
  }
  console.error = originalConsoleError;
});

const PRESENT_PROVENANCE: Provenance = {
  source_name: "source.json",
  source_modified_at: "2026-08-27T12:00:00Z",
  source_plan_sha256: "a".repeat(64),
  dagshund_version: "0.15.0",
  plan_cli_version: "1.14.0",
};

describe("useProvenance", () => {
  test("returns present metadata without logging", () => {
    setEmbeddedProvenance(PRESENT_PROVENANCE);

    const { result } = renderHook(() => useProvenance());

    expect(result.current).toEqual(PRESENT_PROVENANCE);
    expect(consoleErrors).toEqual([]);
  });

  test("treats undefined and null metadata as missing without logging", () => {
    const absent = renderHook(() => useProvenance());

    expect(absent.result.current).toBeNull();

    setEmbeddedProvenance(null);
    const explicitNull = renderHook(() => useProvenance());

    expect(explicitNull.result.current).toBeNull();
    expect(consoleErrors).toEqual([]);
  });

  test("logs malformed metadata and keeps the unknown fallback", () => {
    const malformedMetadata = {
      source_name: "source.json",
      source_modified_at: "not-a-timestamp",
      source_plan_sha256: "not-a-digest",
      dagshund_version: "0.15.0",
      plan_cli_version: null,
      raw_plan: "private plan data",
    };
    setEmbeddedProvenance(malformedMetadata);

    const expected = parseProvenanceJson(malformedMetadata);
    const { result } = renderHook(() => useProvenance());

    expect(result.current).toBeNull();
    expect(expected.ok).toBe(false);
    if (!expected.ok) {
      expect(consoleErrors.join(" ")).toContain(expected.error);
    }
    expect(consoleErrors.join(" ")).toContain("invalid provenance metadata");
    expect(consoleErrors.join(" ")).not.toContain("private plan data");
  });
});
