import { describe, expect, test } from "bun:test";
import { parseProvenanceJson } from "../../src/parser/parse-provenance.ts";

const VALID_PROVENANCE = {
  source_name: "plan.json",
  source_modified_at: "2026-08-27T12:00:00Z",
  source_plan_sha256: "a".repeat(64),
  dagshund_version: "0.15.0",
  plan_cli_version: "1.14.0",
};

describe("parseProvenanceJson", () => {
  test("parses present provenance metadata", () => {
    const result = parseProvenanceJson(VALID_PROVENANCE);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual(VALID_PROVENANCE);
    }
  });

  test("accepts nullable metadata values", () => {
    const result = parseProvenanceJson({
      ...VALID_PROVENANCE,
      source_modified_at: null,
      plan_cli_version: null,
    });

    expect(result.ok).toBe(true);
    if (result.ok && result.data !== null) {
      expect(result.data.source_modified_at).toBeNull();
      expect(result.data.plan_cli_version).toBeNull();
    }
  });

  test("treats an absent global as missing metadata", () => {
    const result = parseProvenanceJson(undefined);

    expect(result).toEqual({ ok: true, data: null });
  });

  test("treats an explicit null global as missing metadata", () => {
    const result = parseProvenanceJson(null);

    expect(result).toEqual({ ok: true, data: null });
  });

  test("accepts a valid UTC ISO timestamp", () => {
    const result = parseProvenanceJson(VALID_PROVENANCE);

    expect(result.ok).toBe(true);
  });

  test("rejects malformed or non-ISO timestamps", () => {
    for (const source_modified_at of [
      "2026-08-27 12:00:00Z",
      "2026-08-27T12:00:00",
      "not-a-timestamp",
    ]) {
      const result = parseProvenanceJson({ ...VALID_PROVENANCE, source_modified_at });

      expect(result.ok).toBe(false);
    }
  });

  test("returns an error for malformed metadata", () => {
    const result = parseProvenanceJson({ source_name: "plan.json" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("expected");
    }
  });

  test("returns an error for uppercase or incorrectly sized SHA-256", () => {
    for (const digest of ["A".repeat(64), "a".repeat(63), "a".repeat(65)]) {
      const result = parseProvenanceJson({ ...VALID_PROVENANCE, source_plan_sha256: digest });

      expect(result.ok).toBe(false);
    }
  });
});
