import { describe, expect, test } from "bun:test";
import {
  buildPrefixedNodeId,
  buildResourceKey,
  buildTaskNodeId,
  extractParentResourceKey,
  extractPhantomBadge,
  extractPhantomResourceType,
  extractResourceName,
  extractSubResourceSuffix,
  extractTaskNodeParentId,
  extractTypeBadge,
  isPhantomLeaf,
  isSubResourceKey,
} from "../../src/utils/resource-key.ts";

describe("buildPrefixedNodeId", () => {
  test("builds registered phantom and hierarchy node IDs", () => {
    expect(buildPrefixedNodeId("sqlWarehouse", "wh1")).toBe("sql-warehouse::wh1");
    expect(buildPrefixedNodeId("schema", "main.analytics")).toBe("schema::main.analytics");
  });
});

describe("buildResourceKey", () => {
  test("builds top-level resource keys", () => {
    expect(buildResourceKey("registered_models", "fraud_detector")).toBe(
      "resources.registered_models.fraud_detector",
    );
  });
});

describe("task node IDs", () => {
  test("round-trips task node IDs to their parent resource key", () => {
    const taskNodeId = buildTaskNodeId("resources.jobs.etl", "load");

    expect(taskNodeId).toBe("resources.jobs.etl::load");
    expect(extractTaskNodeParentId(taskNodeId)).toBe("resources.jobs.etl");
  });

  test("returns unchanged node ID when no task separator is present", () => {
    expect(extractTaskNodeParentId("resources.jobs.etl")).toBe("resources.jobs.etl");
  });
});

describe("extractResourceName", () => {
  test("returns last segment of a dotted key", () => {
    expect(extractResourceName("databricks_job.my_pipeline")).toBe("my_pipeline");
  });

  test("returns last segment for deeply nested keys", () => {
    expect(extractResourceName("a.b.c.d")).toBe("d");
  });

  test("returns the key itself for a single segment", () => {
    expect(extractResourceName("my_resource")).toBe("my_resource");
  });

  test("returns empty string for empty input", () => {
    expect(extractResourceName("")).toBe("");
  });

  test("handles key with trailing dot", () => {
    // "foo.".split(".") => ["foo", ""] — last segment is ""
    expect(extractResourceName("foo.")).toBe("");
  });

  test("handles key with leading dot", () => {
    // ".foo".split(".") => ["", "foo"] — last segment is "foo"
    expect(extractResourceName(".foo")).toBe("foo");
  });
});

describe("extractTypeBadge", () => {
  test("returns mapped badge for known resource types", () => {
    expect(extractTypeBadge("resources.schemas.analytics")).toBe("schema");
    expect(extractTypeBadge("resources.jobs.etl_pipeline")).toBe("job");
    expect(extractTypeBadge("resources.synced_database_tables.customer_360")).toBe(
      "synced database table",
    );
    expect(extractTypeBadge("resources.postgres_databases.app_db")).toBe("postgres database");
    expect(extractTypeBadge("resources.postgres_roles.data_engineers")).toBe("postgres role");
    expect(extractTypeBadge("resources.postgres_synced_tables.phantom_table")).toBe(
      "postgres synced table",
    );
    expect(extractTypeBadge("resources.registered_models.fraud_detector")).toBe("model");
    expect(extractTypeBadge("resources.secrets.api_token")).toBe("secret");
    expect(extractTypeBadge("resources.external_locations.my_loc")).toBe("external location");
  });

  test("falls back to raw segment for unknown resource types", () => {
    expect(extractTypeBadge("resources.unknown_widgets.foo")).toBe("unknown_widgets");
  });

  test("returns undefined when key has no type segment", () => {
    expect(extractTypeBadge("resources")).toBeUndefined();
    expect(extractTypeBadge("")).toBeUndefined();
  });
});

describe("extractPhantomResourceType", () => {
  test("returns the normalized type for workspace phantom leaves", () => {
    expect(extractPhantomResourceType("job::123")).toBe("jobs");
    expect(extractPhantomResourceType("sql-warehouse::abc")).toBe("sql_warehouses");
    expect(extractPhantomResourceType("database-instance::main")).toBe("database_instances");
  });

  test("returns undefined for hierarchy phantoms and real resources", () => {
    expect(extractPhantomResourceType("source-table::prod.raw.events")).toBeUndefined();
    expect(extractPhantomResourceType("catalog::prod")).toBeUndefined();
    expect(extractPhantomResourceType("resources.jobs.etl")).toBeUndefined();
  });
});

describe("isPhantomLeaf", () => {
  test("returns true for source-table phantom nodes", () => {
    expect(isPhantomLeaf("source-table::prod.staging.customers")).toBe(true);
  });

  test("returns true for database-instance phantom nodes", () => {
    expect(isPhantomLeaf("database-instance::my_db_instance")).toBe(true);
  });

  test("returns true for dashboard phantom nodes", () => {
    expect(isPhantomLeaf("dashboard::abc123")).toBe(true);
  });

  test("returns true for genie space phantom nodes", () => {
    expect(isPhantomLeaf("genie-space::space-abc")).toBe(true);
  });

  test("returns false for hierarchy phantom prefixes", () => {
    expect(isPhantomLeaf("catalog::prod")).toBe(false);
    expect(isPhantomLeaf("schema::prod.staging")).toBe(false);
    expect(isPhantomLeaf("postgres-project::my_project")).toBe(false);
    expect(isPhantomLeaf("postgres-branch::my_project/main")).toBe(false);
    expect(isPhantomLeaf("postgres-database::my_project/main/app_db")).toBe(false);
  });

  test("returns false for real resource keys", () => {
    expect(isPhantomLeaf("resources.schemas.analytics")).toBe(false);
  });

  test("returns false for empty string", () => {
    expect(isPhantomLeaf("")).toBe(false);
  });
});

describe("isSubResourceKey", () => {
  test("returns false for standard 3-segment resource key", () => {
    expect(isSubResourceKey("resources.jobs.test_job")).toBe(false);
  });

  test("returns true for 4-segment key (permissions)", () => {
    expect(isSubResourceKey("resources.jobs.test_job.permissions")).toBe(true);
  });

  test("returns true for 5-segment key", () => {
    expect(isSubResourceKey("resources.jobs.test_job.grants.extra")).toBe(true);
  });

  test("returns false for 2-segment key", () => {
    expect(isSubResourceKey("resources.jobs")).toBe(false);
  });

  test("returns false for 1-segment key", () => {
    expect(isSubResourceKey("resources")).toBe(false);
  });

  test("returns false for empty string", () => {
    expect(isSubResourceKey("")).toBe(false);
  });
});

describe("extractParentResourceKey", () => {
  test("extracts first 3 segments from a 4-segment key", () => {
    expect(extractParentResourceKey("resources.jobs.test_job.permissions")).toBe(
      "resources.jobs.test_job",
    );
  });

  test("extracts first 3 segments from a 5-segment key", () => {
    expect(extractParentResourceKey("resources.jobs.test_job.grants.extra")).toBe(
      "resources.jobs.test_job",
    );
  });

  test("returns the key unchanged for a 3-segment key", () => {
    expect(extractParentResourceKey("resources.jobs.test_job")).toBe("resources.jobs.test_job");
  });

  test("returns partial key for fewer than 3 segments", () => {
    expect(extractParentResourceKey("resources.jobs")).toBe("resources.jobs");
  });
});

describe("extractSubResourceSuffix", () => {
  test("extracts suffix from a 4-segment key", () => {
    expect(extractSubResourceSuffix("resources.jobs.test_job.permissions")).toBe("permissions");
  });

  test("extracts compound suffix from a 5-segment key", () => {
    expect(extractSubResourceSuffix("resources.jobs.test_job.grants.extra")).toBe("grants.extra");
  });

  test("returns empty string for a 3-segment key", () => {
    expect(extractSubResourceSuffix("resources.jobs.test_job")).toBe("");
  });
});

describe("extractPhantomBadge", () => {
  test("returns badge for each phantom prefix", () => {
    expect(extractPhantomBadge("catalog::prod")).toBe("catalog");
    expect(extractPhantomBadge("schema::prod.staging")).toBe("schema");
    expect(extractPhantomBadge("source-table::prod.staging.customers")).toBe("table");
    expect(extractPhantomBadge("database-instance::my_db")).toBe("database instance");
    expect(extractPhantomBadge("dashboard::abc123")).toBe("dashboard");
    expect(extractPhantomBadge("genie-space::space-abc")).toBe("genie");
    expect(extractPhantomBadge("postgres-project::my_project")).toBe("postgres project");
    expect(extractPhantomBadge("postgres-branch::proj/main")).toBe("postgres branch");
    expect(extractPhantomBadge("postgres-database::proj/main/app_db")).toBe("postgres database");
  });

  test("falls back to extractTypeBadge for real resource keys", () => {
    expect(extractPhantomBadge("resources.schemas.analytics")).toBe("schema");
    expect(extractPhantomBadge("resources.jobs.etl")).toBe("job");
  });

  test("returns undefined for unrecognized keys", () => {
    expect(extractPhantomBadge("resources")).toBeUndefined();
  });
});
