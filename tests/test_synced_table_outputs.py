from factories import make_resource

from dagshund.synced_table_outputs import (
    OutputRelationship,
    SyncedTableOutput,
    extract_synced_table_outputs,
)


def test_extract_synced_table_outputs_postgres_create_returns_pipeline_and_registration() -> None:
    key = "resources.postgres_synced_tables.orders"
    entry = make_resource(
        key,
        action="create",
        new_state={"value": {"synced_table_id": "lakebase.public.orders", "new_pipeline_spec": {}}},
    )

    result = extract_synced_table_outputs(key, entry)

    assert result == (
        SyncedTableOutput(OutputRelationship.MANAGED, "pipeline", "orders pipeline"),
        SyncedTableOutput(OutputRelationship.MANAGED, "Unity Catalog registration", "lakebase.public.orders"),
    )


def test_extract_synced_table_outputs_postgres_delete_uses_remote_state() -> None:
    key = "resources.postgres_synced_tables.orders"
    entry = make_resource(
        key,
        action="delete",
        remote_state={"synced_table_id": "lakebase.public.orders", "status": {"pipeline_id": "pipeline-id"}},
    )

    result = extract_synced_table_outputs(key, entry)

    assert result == (
        SyncedTableOutput(OutputRelationship.MANAGED, "pipeline", "orders pipeline"),
        SyncedTableOutput(OutputRelationship.MANAGED, "Unity Catalog registration", "lakebase.public.orders"),
    )


def test_extract_synced_table_outputs_postgres_missing_state_returns_stable_pipeline() -> None:
    key = "resources.postgres_synced_tables.orders"
    entry = make_resource(key, action="create")

    result = extract_synced_table_outputs(key, entry)

    assert result == (SyncedTableOutput(OutputRelationship.MANAGED, "pipeline", "orders pipeline"),)


def test_extract_synced_table_outputs_postgres_malformed_registration_omits_registration() -> None:
    key = "resources.postgres_synced_tables.orders"
    entry = make_resource(key, new_state={"value": {"synced_table_id": "catalog.table"}})

    result = extract_synced_table_outputs(key, entry)

    assert result == (SyncedTableOutput(OutputRelationship.MANAGED, "pipeline", "orders pipeline"),)


def test_extract_synced_table_outputs_existing_pipeline_returns_reference() -> None:
    key = "resources.postgres_synced_tables.orders"
    entry = make_resource(
        key,
        new_state={"value": {"existing_pipeline_id": "shared-pipeline", "synced_table_id": "c.s.orders"}},
    )

    result = extract_synced_table_outputs(key, entry)

    assert result[0] == SyncedTableOutput(OutputRelationship.REFERENCED, "pipeline", "shared-pipeline")


def test_extract_synced_table_outputs_database_table_returns_all_surfaces() -> None:
    key = "resources.synced_database_tables.customer_360"
    entry = make_resource(
        key,
        action="create",
        new_state={
            "value": {
                "name": "lakebase_analytics.analytics_data.customer_360",
                "database_instance_name": "analytics_db",
                "logical_database_name": "analytics_data",
                "spec": {"new_pipeline_spec": {}},
            }
        },
    )

    result = extract_synced_table_outputs(key, entry)

    assert result == (
        SyncedTableOutput(OutputRelationship.MANAGED, "pipeline", "customer_360 pipeline"),
        SyncedTableOutput(
            OutputRelationship.MANAGED,
            "PostgreSQL table",
            "customer_360 (analytics_db/analytics_data)",
        ),
        SyncedTableOutput(
            OutputRelationship.MANAGED,
            "Unity Catalog registration",
            "lakebase_analytics.analytics_data.customer_360",
        ),
    )


def test_extract_synced_table_outputs_database_table_delete_allows_inferred_location() -> None:
    key = "resources.synced_database_tables.customer_360"
    entry = make_resource(
        key,
        action="delete",
        remote_state={"name": "registered.analytics.customer_360"},
    )

    result = extract_synced_table_outputs(key, entry)

    assert result[1:] == (
        SyncedTableOutput(OutputRelationship.MANAGED, "PostgreSQL table", "customer_360"),
        SyncedTableOutput(
            OutputRelationship.MANAGED,
            "Unity Catalog registration",
            "registered.analytics.customer_360",
        ),
    )


def test_extract_synced_table_outputs_database_table_missing_name_returns_stable_pipeline() -> None:
    key = "resources.synced_database_tables.customer_360"
    entry = make_resource(key, new_state={"value": {"database_instance_name": "analytics_db"}})

    result = extract_synced_table_outputs(key, entry)

    assert result == (SyncedTableOutput(OutputRelationship.MANAGED, "pipeline", "customer_360 pipeline"),)


def test_extract_synced_table_outputs_database_table_malformed_name_omits_table_surfaces() -> None:
    key = "resources.synced_database_tables.customer_360"
    entry = make_resource(key, new_state={"value": {"name": "catalog.table"}})

    result = extract_synced_table_outputs(key, entry)

    assert result == (SyncedTableOutput(OutputRelationship.MANAGED, "pipeline", "customer_360 pipeline"),)


def test_extract_synced_table_outputs_database_table_reads_nested_existing_pipeline() -> None:
    key = "resources.synced_database_tables.customer_360"
    entry = make_resource(
        key,
        new_state={
            "value": {
                "name": "registered.analytics.customer_360",
                "spec": {"existing_pipeline_id": "shared-pipeline"},
            }
        },
    )

    result = extract_synced_table_outputs(key, entry)

    assert result[0] == SyncedTableOutput(OutputRelationship.REFERENCED, "pipeline", "shared-pipeline")


def test_extract_synced_table_outputs_unrelated_resource_returns_empty() -> None:
    key = "resources.pipelines.orders"
    entry = make_resource(key, new_state={"value": {"name": "orders"}})

    result = extract_synced_table_outputs(key, entry)

    assert result == ()
