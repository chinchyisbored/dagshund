import { describe, expect, test } from "bun:test";
import cleanupCases from "../../../fixtures/state-cleanup-cases.json";
import { splitMeaningfulChanges } from "../../src/components/detail-panel/filter-changes.ts";
import { isStateCleanup } from "../../src/parser/map-diff-state.ts";
import { parsePlanFromString, parsePlanJson } from "../../src/parser/parse-plan.ts";
import { serializePlanWithProviderComparisonFacts } from "../../src/utils/provider-comparison-facts.ts";
import { isFieldDriftChange, isTopologyDriftChange } from "../../src/utils/structural-diff.ts";
import { isUnknownRecord } from "../../src/utils/unknown-record.ts";

describe("parsePlanJson", () => {
  test("preserves shared cleanup flags and classifies only literal true on delete", () => {
    for (const vector of cleanupCases) {
      const rawEntry = Object.fromEntries(
        Object.entries(vector).filter(([key]) => key !== "name" && key !== "cleanup"),
      );
      const input = { plan: { "resources.test.cleanup": rawEntry } };
      const original = structuredClone(input);
      const result = parsePlanJson(input);

      expect(result.ok).toBe(true);
      if (result.ok) {
        const entry = result.data.plan?.["resources.test.cleanup"];
        expect(entry).toBeDefined();
        expect(isStateCleanup(entry ?? {})).toBe(vector.cleanup);
        expect(String(entry?.action)).toBe(vector.action);
        expect(entry?.gone).toBe(vector.gone);
        expect(entry?.state_only).toBe(vector.state_only);
      }
      expect(input).toEqual(original);
    }
  });
  test("parses a minimal valid plan", () => {
    const result = parsePlanJson({});
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual({});
    }
  });

  test("parses a plan with all top-level fields", () => {
    const input = {
      plan_version: 1,
      cli_version: "0.250.0",
      lineage: "abc-123",
      serial: 42,
      plan: {},
    };
    const result = parsePlanJson(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.plan_version).toBe(1);
      expect(result.data.cli_version).toBe("0.250.0");
      expect(result.data.lineage).toBe("abc-123");
      expect(result.data.serial).toBe(42);
      expect(result.data.plan).toEqual({});
    }
  });

  test("parses a plan with entries and dependencies", () => {
    const input = {
      plan_version: 1,
      plan: {
        "databricks_job.etl_pipeline": {
          id: "123456",
          depends_on: [
            { node: "databricks_cluster.shared", label: "cluster" },
            { node: "databricks_secret_scope.creds" },
          ],
          action: "create",
          new_state: { name: "etl_pipeline" },
          changes: {
            name: {
              action: "create",
              new: "etl_pipeline",
            },
          },
        },
      },
    };
    const result = parsePlanJson(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const entry = result.data.plan?.["databricks_job.etl_pipeline"];
      expect(entry).toBeDefined();
      expect(entry?.id).toBe("123456");
      expect(entry?.depends_on).toHaveLength(2);
      expect(entry?.depends_on?.[0]?.node).toBe("databricks_cluster.shared");
      expect(entry?.depends_on?.[0]?.label).toBe("cluster");
      expect(entry?.depends_on?.[1]?.label).toBeUndefined();
      expect(entry?.action).toBe("create");
      expect(entry?.changes?.["name"]?.action).toBe("create");
    }
  });

  test("redacts provider credentials in snapshots and leaf or aggregate changes", () => {
    const input = {
      plan: {
        "resources.model_provider_services.provider": {
          action: "update",
          new_state: {
            value: {
              config: {
                amazon_bedrock: {
                  direct: {
                    aws_access_key: {
                      access_key_id: "AWS_ID_SENTINEL",
                      secret_access_key: { plaintext: "AWS_SECRET_SENTINEL" },
                    },
                  },
                },
              },
            },
          },
          changes: {
            "config.amazon_bedrock.direct.aws_access_key.access_key_id": {
              action: "update",
              old: "OLD_ID_SENTINEL",
              new: "NEW_ID_SENTINEL",
              remote: "REMOTE_ID_SENTINEL",
            },
            "config.amazon_bedrock.direct": {
              action: "update",
              old: { plaintext: "OLD_SECRET_SENTINEL" },
              new: { plaintext: "NEW_SECRET_SENTINEL" },
              remote: { plaintext: "REMOTE_SECRET_SENTINEL" },
            },
          },
        },
      },
    };

    const result = parsePlanJson(input);

    expect(result.ok).toBe(true);
    if (result.ok) {
      const serialized = JSON.stringify(result.data);
      for (const sentinel of [
        "AWS_ID_SENTINEL",
        "AWS_SECRET_SENTINEL",
        "OLD_ID_SENTINEL",
        "NEW_ID_SENTINEL",
        "REMOTE_ID_SENTINEL",
        "OLD_SECRET_SENTINEL",
        "NEW_SECRET_SENTINEL",
        "REMOTE_SECRET_SENTINEL",
      ]) {
        expect(serialized).not.toContain(sentinel);
      }
    }
    expect(
      input.plan["resources.model_provider_services.provider"].new_state.value.config.amazon_bedrock
        .direct.aws_access_key.access_key_id,
    ).toBe("AWS_ID_SENTINEL");
  });

  test("preserves safe provider aggregate values and safe leaf distinctions", () => {
    const input = {
      plan: {
        "resources.model_provider_services.provider": {
          changes: {
            "config.azure_openai.direct": {
              action: "update",
              old: {
                base_url: "https://safe.example",
                service_credential: { name: "credentials/safe" },
              },
              new: {
                base_url: "https://safe.example",
                service_credential: { name: "credentials/safe" },
              },
              remote: {
                base_url: "https://safe.example",
                service_credential: { name: "credentials/safe" },
              },
            },
            "config.openai.direct.api_key": {
              action: "update",
              old: {},
              new: "",
            },
          },
        },
      },
    };

    const result = parsePlanJson(input);

    expect(result.ok).toBe(true);
    if (result.ok) {
      const entry = result.data.plan?.["resources.model_provider_services.provider"];
      expect(entry?.changes?.["config.azure_openai.direct"]?.old).toEqual({
        base_url: "https://safe.example",
        service_credential: { name: "credentials/safe" },
      });
      expect(entry?.changes?.["config.azure_openai.direct"]?.new).toEqual({
        base_url: "https://safe.example",
        service_credential: { name: "credentials/safe" },
      });
      expect(entry?.changes?.["config.azure_openai.direct"]?.remote).toEqual({
        base_url: "https://safe.example",
        service_credential: { name: "credentials/safe" },
      });
      expect(entry?.changes?.["config.openai.direct.api_key"]?.old).toEqual({});
      expect(entry?.changes?.["config.openai.direct.api_key"]?.new).toBe("");
      expect(JSON.stringify(result.data)).toContain("credentials/safe");
    }
  });

  test("preserves provider credential comparison semantics without topology false positives", () => {
    const parseChange = (old: string, next: string, remote?: string) => {
      const result = parsePlanJson({
        plan: {
          "resources.model_provider_services.provider": {
            changes: {
              "config.openai.direct.api_key.plaintext": {
                action: "update",
                old,
                new: next,
                ...(remote === undefined ? {} : { remote }),
              },
            },
          },
        },
      });
      if (!result.ok) throw new Error(result.error);
      return result.data.plan?.["resources.model_provider_services.provider"]?.changes?.[
        "config.openai.direct.api_key.plaintext"
      ];
    };

    const rotation = parseChange("OLD_SENTINEL", "NEW_SENTINEL");
    const topology = parseChange("OLD_SENTINEL", "OLD_SENTINEL");
    const drift = parseChange("OLD_SENTINEL", "OLD_SENTINEL", "REMOTE_SENTINEL");
    const aggregate = (old: string, next: string, remote?: string) => {
      const result = parsePlanJson({
        plan: {
          "resources.model_provider_services.provider": {
            changes: {
              "config.openai.direct": {
                action: "update",
                old: { api_key: { plaintext: old }, base_url: "https://safe.example" },
                new: { api_key: { plaintext: next }, base_url: "https://safe.example" },
                ...(remote === undefined
                  ? {}
                  : {
                      remote: { api_key: { plaintext: remote }, base_url: "https://safe.example" },
                    }),
              },
            },
          },
        },
      });
      if (!result.ok) throw new Error(result.error);
      return result.data.plan?.["resources.model_provider_services.provider"]?.changes?.[
        "config.openai.direct"
      ];
    };
    const aggregateRotation = aggregate("OLD_SENTINEL", "NEW_SENTINEL");
    const aggregateDrift = aggregate("OLD_SENTINEL", "OLD_SENTINEL", "REMOTE_SENTINEL");
    expect(rotation).toBeDefined();
    expect(topology).toBeDefined();
    expect(drift).toBeDefined();
    expect(aggregateRotation).toBeDefined();
    expect(aggregateDrift).toBeDefined();
    if (rotation !== undefined) expect(isTopologyDriftChange(rotation)).toBe(false);
    if (topology !== undefined) expect(isTopologyDriftChange(topology)).toBe(true);
    if (drift !== undefined) {
      expect(isTopologyDriftChange(drift)).toBe(false);
      expect(isFieldDriftChange(drift)).toBe(true);
      expect(
        splitMeaningfulChanges(
          { credential: drift },
          {
            newState: undefined,
            remoteState: undefined,
            resourceHasShapeDrift: false,
          },
        ).fieldChanges.map(([key]) => key),
      ).toEqual(["credential"]);
    }
    if (aggregateRotation !== undefined) {
      expect(isTopologyDriftChange(aggregateRotation)).toBe(false);
      expect(
        splitMeaningfulChanges(
          { credential: aggregateRotation },
          {
            newState: undefined,
            remoteState: undefined,
            resourceHasShapeDrift: false,
          },
        ).fieldChanges.map(([key]) => key),
      ).toEqual(["credential"]);
    }
    if (aggregateDrift !== undefined) {
      expect(isTopologyDriftChange(aggregateDrift)).toBe(false);
      expect(isFieldDriftChange(aggregateDrift)).toBe(true);
      expect(
        splitMeaningfulChanges(
          { credential: aggregateDrift },
          {
            newState: undefined,
            remoteState: undefined,
            resourceHasShapeDrift: false,
          },
        ).fieldChanges.map(([key]) => key),
      ).toEqual(["credential"]);
    }

    const unknownRemote = parseChange("OLD_SENTINEL", "OLD_SENTINEL", "[redacted]");
    const unknownOldNew = parseChange("[redacted]", "[redacted]");
    expect(unknownRemote).toBeDefined();
    expect(unknownOldNew).toBeDefined();
    if (unknownRemote !== undefined) {
      expect(isFieldDriftChange(unknownRemote)).toBe(false);
      expect(
        splitMeaningfulChanges(
          { credential: unknownRemote },
          {
            newState: undefined,
            remoteState: undefined,
            resourceHasShapeDrift: false,
          },
        ).fieldChanges.map(([key]) => key),
      ).toEqual(["credential"]);
    }
    if (unknownOldNew !== undefined) {
      expect(isFieldDriftChange(unknownOldNew)).toBe(false);
      expect(
        splitMeaningfulChanges(
          { credential: unknownOldNew },
          {
            newState: undefined,
            remoteState: undefined,
            resourceHasShapeDrift: false,
          },
        ).fieldChanges.map(([key]) => key),
      ).toEqual(["credential"]);
    }
  });

  test("preserves provider comparison facts through stdin server JSON transport", async () => {
    const cases = [
      {
        path: "config.openai.direct.api_key.plaintext",
        old: "OLD_SENTINEL",
        new: "OLD_SENTINEL",
        remote: "REMOTE_SENTINEL",
        expectedDrift: true,
      },
      {
        path: "config.openai.direct.api_key.plaintext",
        old: "OLD_SENTINEL",
        new: "OLD_SENTINEL",
        expectedDrift: false,
        expectedTopology: true,
      },
      {
        path: "config.openai.direct",
        old: { api_key: { plaintext: "OLD_SENTINEL" }, base_url: "https://safe.example" },
        new: { api_key: { plaintext: "OLD_SENTINEL" }, base_url: "https://safe.example" },
        remote: { api_key: { plaintext: "REMOTE_SENTINEL" }, base_url: "https://safe.example" },
        expectedDrift: true,
      },
      {
        path: "config.openai.direct.api_key.plaintext",
        old: "[redacted]",
        new: "[redacted]",
        remote: "[redacted]",
        expectedDrift: false,
      },
    ] as const;

    for (const changeCase of cases) {
      const parsed = parsePlanJson({
        plan: {
          "resources.model_provider_services.provider": {
            changes: {
              [changeCase.path]: {
                action: "update",
                old: changeCase.old,
                new: changeCase.new,
                ...("remote" in changeCase ? { remote: changeCase.remote } : {}),
              },
            },
          },
        },
      });
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) continue;

      const response = Response.json(serializePlanWithProviderComparisonFacts(parsed.data));
      const transported: unknown = await response.json();
      const received = parsePlanJson(transported);
      expect(received.ok).toBe(true);
      if (!received.ok) continue;
      const change =
        received.data.plan?.["resources.model_provider_services.provider"]?.changes?.[
          changeCase.path
        ];
      expect(change).toBeDefined();
      if (change === undefined) continue;
      expect(isFieldDriftChange(change)).toBe(changeCase.expectedDrift);
      if ("expectedTopology" in changeCase)
        expect(isTopologyDriftChange(change)).toBe(changeCase.expectedTopology);
      if (!("expectedTopology" in changeCase)) {
        expect(
          splitMeaningfulChanges(
            { credential: change },
            { newState: undefined, remoteState: undefined, resourceHasShapeDrift: false },
          ).fieldChanges.map(([key]) => key),
        ).toEqual(["credential"]);
      }
      expect(JSON.stringify(transported)).not.toContain("OLD_SENTINEL");
      expect(JSON.stringify(transported)).not.toContain("REMOTE_SENTINEL");
      expect(JSON.stringify(received.data)).not.toContain("_dagshund_provider_comparison_facts");
    }
  });

  test("restores safe comparison facts from embedded plans without exposing credentials", () => {
    const result = parsePlanFromString(
      JSON.stringify({
        plan: {
          "resources.model_provider_services.provider": {
            changes: {
              "config.openai.direct.api_key.plaintext": {
                action: "update",
                old: "[redacted]",
                new: "[redacted]",
                remote: "[redacted]",
                _dagshund_provider_comparison_facts: {
                  old_new_equal: true,
                  old_remote_equal: false,
                },
              },
            },
          },
        },
      }),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      const change =
        result.data.plan?.["resources.model_provider_services.provider"]?.changes?.[
          "config.openai.direct.api_key.plaintext"
        ];
      expect(change).toBeDefined();
      if (change !== undefined) {
        expect(isFieldDriftChange(change)).toBe(true);
        expect(JSON.stringify(result.data)).not.toContain("_dagshund_provider_comparison_facts");
      }
    }
  });

  test("redacts every schema provider credential arm", () => {
    const paths = [
      ["anthropic", "direct", "api_key", "plaintext"],
      ["azure_openai", "direct", "api_key", "plaintext"],
      ["azure_openai", "direct", "entra_service_principal", "client_secret", "plaintext"],
      ["custom", "direct", "api_key", "plaintext"],
      ["gemini_enterprise", "direct", "api_key", "plaintext"],
      ["microsoft_foundry", "direct", "api_key", "plaintext"],
      ["microsoft_foundry", "direct", "entra_service_principal", "client_secret", "plaintext"],
      ["openai", "direct", "api_key", "plaintext"],
      ["amazon_bedrock", "direct", "aws_access_key", "secret_access_key", "plaintext"],
      ["amazon_bedrock", "direct", "aws_access_key", "access_key_id"],
    ] as const;
    const config: Record<string, unknown> = {};
    for (const [index, path] of paths.entries()) {
      let current = config;
      for (const segment of path.slice(0, -1)) {
        const child = current[segment];
        if (isUnknownRecord(child)) {
          current = child;
        } else {
          const nested: Record<string, unknown> = {};
          current[segment] = nested;
          current = nested;
        }
      }
      current[path.at(-1) ?? ""] = `PROVIDER_SENTINEL_${index}`;
    }

    const result = parsePlanJson({
      plan: {
        "resources.model_provider_services.provider": {
          new_state: { value: { config } },
        },
      },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      const serialized = JSON.stringify(result.data);
      for (const index of paths.keys()) {
        expect(serialized).not.toContain(`PROVIDER_SENTINEL_${index}`);
      }
    }
  });

  test("redacts Unity Catalog secret values without mutating input", () => {
    const input = {
      plan: {
        "resources.secrets.api_token": {
          action: "update",
          new_state: {
            effective_value: "outer-effective-value",
            value: {
              name: "api_token",
              value: "new-secret-value",
              effective_value: "new-effective-value",
            },
          },
          remote_state: {
            name: "api_token",
            value: "[redacted]",
            effective_value: "[redacted]",
          },
          changes: {
            value: {
              action: "update",
              old: "",
              new: "[redacted]",
              remote: "[redacted]",
            },
          },
        },
        "resources.secret_scopes.legacy": {
          new_state: { value: { value: "not-a-uc-secret-value" } },
        },
      },
    };

    const result = parsePlanJson(input);

    expect(result.ok).toBe(true);
    if (result.ok) {
      const secret = result.data.plan?.["resources.secrets.api_token"];
      expect(secret?.new_state).toEqual({
        effective_value: "[redacted]",
        value: {
          name: "api_token",
          value: "[redacted]",
          effective_value: "[redacted]",
        },
      });
      expect(secret?.remote_state).toEqual({
        name: "api_token",
        value: "[redacted]",
        effective_value: "[redacted]",
      });
      expect(secret?.changes?.["value"]).toEqual({
        action: "update",
        old: "",
        new: "[redacted]",
        remote: "[redacted]",
      });
      expect(result.data.plan?.["resources.secret_scopes.legacy"]?.new_state).toEqual({
        value: { value: "not-a-uc-secret-value" },
      });
      expect(JSON.stringify(result.data)).not.toContain("new-secret-value");
      expect(JSON.stringify(result.data)).not.toContain("outer-effective-value");
    }
    expect(input.plan["resources.secrets.api_token"].new_state.value.value).toBe(
      "new-secret-value",
    );
  });

  test("redacts malformed Unity Catalog secret states", () => {
    const malformedStates: readonly unknown[] = [
      "UC_SECRET_SENTINEL",
      42,
      true,
      ["UC_SECRET_SENTINEL"],
    ];

    for (const malformedState of malformedStates) {
      const input = {
        plan: {
          "resources.secrets.api_token": {
            new_state: malformedState,
            remote_state: malformedState,
          },
        },
      };
      const result = parsePlanJson(input);

      expect(result.ok).toBe(true);
      if (result.ok) {
        const secret = result.data.plan?.["resources.secrets.api_token"];
        expect(secret?.new_state).toBe("[redacted]");
        expect(secret?.remote_state).toBe("[redacted]");
        expect(JSON.stringify(result.data)).not.toContain("UC_SECRET_SENTINEL");
      }
      expect(input.plan["resources.secrets.api_token"].new_state).toBe(malformedState);
    }
  });

  test("preserves null and absent Unity Catalog secret states", () => {
    const result = parsePlanJson({
      plan: {
        "resources.secrets.null_state": { new_state: null, remote_state: null },
        "resources.secrets.absent_state": {},
      },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      const nullState = result.data.plan?.["resources.secrets.null_state"];
      const absentState = result.data.plan?.["resources.secrets.absent_state"];
      expect(nullState?.new_state).toBeNull();
      expect(nullState?.remote_state).toBeNull();
      expect(Object.hasOwn(absentState ?? {}, "new_state")).toBe(false);
      expect(Object.hasOwn(absentState ?? {}, "remote_state")).toBe(false);
    }
  });

  test("rejects a malformed Unity Catalog secret entry", () => {
    const result = parsePlanJson({
      plan: { "resources.secrets.api_token": "UC_SECRET_SENTINEL" },
    });

    expect(result.ok).toBe(false);
  });

  test("parses entries with missing optional fields", () => {
    const input = {
      plan: {
        "databricks_job.minimal": {},
      },
    };
    const result = parsePlanJson(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const entry = result.data.plan?.["databricks_job.minimal"];
      expect(entry).toBeDefined();
      expect(entry?.id).toBeUndefined();
      expect(entry?.depends_on).toBeUndefined();
      expect(entry?.action).toBeUndefined();
      expect(entry?.new_state).toBeUndefined();
      expect(entry?.remote_state).toBeUndefined();
      expect(entry?.changes).toBeUndefined();
    }
  });

  test("returns a value-free error for invalid schema", () => {
    const result = parsePlanJson({
      plan_version: "not_a_number",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("Invalid plan JSON");
  });

  test("coerces unknown action type to 'unknown'", () => {
    const result = parsePlanJson({
      plan: {
        "some.resource": {
          action: "invalid_action",
        },
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.plan?.["some.resource"]?.action).toBe("unknown");
    }
  });

  test("returns error for non-object input", () => {
    const result = parsePlanJson("not an object");
    expect(result.ok).toBe(false);
  });

  test("returns error for null input", () => {
    const result = parsePlanJson(null);
    expect(result.ok).toBe(false);
  });
});

describe("parsePlanFromString", () => {
  test("parses valid JSON string", () => {
    const result = parsePlanFromString('{"plan_version": 1}');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.plan_version).toBe(1);
    }
  });

  test("does not echo provider credentials in invalid JSON diagnostics", () => {
    const input =
      '{"plan":{"resources.model_provider_services.provider":{"new_state":{"value":{"config":{"openai":{"direct":{"api_key":{"plaintext":CREDENTIAL_SENTINEL}}}}}}}}}';
    const result = parsePlanFromString(input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("Invalid JSON");
      expect(result.error).not.toContain("CREDENTIAL_SENTINEL");
    }
  });

  test("returns a value-free error for invalid JSON syntax", () => {
    const result = parsePlanFromString("{not valid json}");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("Invalid JSON");
  });

  test("returns error for empty string", () => {
    const result = parsePlanFromString("");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Invalid JSON");
    }
  });

  test("returns a value-free error for invalid schema", () => {
    const result = parsePlanFromString('{"plan_version": "oops"}');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("Invalid plan JSON");
  });

  test("round-trips through invalid fixture file", async () => {
    const fixture = await Bun.file("../fixtures/golden/invalid-plan.json").text();
    const result = parsePlanFromString(fixture);
    expect(result.ok).toBe(false);
  });
});
