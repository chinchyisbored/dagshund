# Databricks notebook source
import inspect
import os

import cloudpickle
import mlflow
import mlflow.pyfunc
from mlflow.entities import ViewType
from mlflow.models import ModelSignature, get_model_info
from mlflow.types.schema import ColSpec, Schema

FIXTURE_TAG = "dagshund_ml_workflow"


def identity(value):
    return value


def require_supported_mlflow() -> str:
    installed_version = mlflow.__version__
    if installed_version != "3.12.0":
        raise RuntimeError(f"Preinstalled MLflow {installed_version} is unsupported; expected 3.12.0")

    log_parameters = inspect.signature(mlflow.pyfunc.log_model).parameters
    registration_parameters = inspect.signature(mlflow.tracking.MlflowClient.create_model_version).parameters
    if not {"name", "python_model", "signature", "pip_requirements", "tags"}.issubset(log_parameters):
        raise RuntimeError("Preinstalled MLflow cannot log the required signed callable")
    if not {"model_id", "run_id", "tags", "await_creation_for"}.issubset(registration_parameters):
        raise RuntimeError("Preinstalled MLflow cannot register the LoggedModel with native provenance")

    client_type = mlflow.tracking.MlflowClient
    client_parameters = {
        "get_model_version": {"name", "version"},
        "search_runs": {"run_view_type", "max_results", "page_token"},
        "search_logged_models": {"experiment_ids", "max_results", "page_token"},
        "search_model_versions": {"filter_string", "max_results", "page_token"},
        "create_model_version": {"name", "source", "model_id", "run_id", "tags", "await_creation_for"},
    }
    if any(
        not parameters.issubset(inspect.signature(getattr(client_type, method)).parameters)
        for method, parameters in client_parameters.items()
    ):
        raise RuntimeError("Preinstalled MLflow APIs lack required bounded registration parameters")
    required = (
        hasattr(client_type, "get_registered_model"),
        hasattr(client_type, "get_experiment"),
        hasattr(client_type, "get_run"),
        hasattr(client_type, "search_runs"),
        hasattr(client_type, "search_logged_models"),
        hasattr(client_type, "get_logged_model"),
        hasattr(client_type, "search_model_versions"),
        hasattr(client_type, "get_model_version"),
        hasattr(client_type, "create_model_version"),
        hasattr(mlflow, "set_tracking_uri"),
        hasattr(mlflow, "set_registry_uri"),
        hasattr(mlflow, "start_run"),
        hasattr(mlflow, "set_tag"),
        hasattr(mlflow.models, "get_model_info"),
    )
    if not all(required):
        raise RuntimeError("Preinstalled MLflow lacks required LoggedModel APIs")
    return f"mlflow=={installed_version}"


def collect_search_pages(search_page, limit):
    records = []
    page_token = None
    seen_tokens = set()
    for _ in range(limit + 1):
        page = search_page(page_token=page_token, max_results=limit + 1)
        records.extend(page)
        if len(records) > limit:
            raise RuntimeError("Owned MLflow resources exceed the bounded fixture membership")
        next_token = page.token
        if next_token is None or next_token == "":
            return records
        if not isinstance(next_token, str) or next_token in seen_tokens:
            raise RuntimeError("MLflow membership search returned an invalid continuation token")
        seen_tokens.add(next_token)
        page_token = next_token
    raise RuntimeError("MLflow membership search exceeded its bounded page count")


def read_snapshot(client, experiment_id, model_name):
    runs = collect_search_pages(
        lambda **page: client.search_runs([experiment_id], run_view_type=ViewType.ALL, **page),
        1,
    )
    models = collect_search_pages(
        lambda **page: client.search_logged_models([experiment_id], **page),
        1,
    )
    versions = collect_search_pages(
        lambda **page: client.search_model_versions(f"name='{model_name}'", **page),
        2,
    )
    return runs, models, sorted(versions, key=lambda version: int(version.version))


def verify_model_and_run(client, model, run, experiment_id, model_id, run_id, signature):
    if (
        not model_id
        or not run_id
        or model.model_id != model_id
        or model.source_run_id != run_id
        or model.name != "identity_model"
        or model.status != "READY"
        or model.tags.get("fixture") != FIXTURE_TAG
        or not model.artifact_location
        or model.experiment_id != experiment_id
        or run.info.run_id != run_id
        or run.info.experiment_id != experiment_id
        or run.info.lifecycle_stage != "active"
        or run.info.status != "FINISHED"
        or run.data.tags.get("fixture") != FIXTURE_TAG
        or run.data.tags.get("fixture_model_uri") != f"models:/{model_id}"
        or run.data.tags.get("fixture_model_source") != model.artifact_location
    ):
        raise RuntimeError("LoggedModel or run has incomplete or conflicting ownership provenance")
    info = get_model_info(f"models:/{model_id}")
    if (
        info.model_id != model_id
        or info.run_id != run_id
        or info.signature != signature
        or info.saved_input_example_info is not None
    ):
        raise RuntimeError("Stored model metadata does not match the signed identity artifact")


def verify_version(client, version, model_name, expected, experiment_id, model_id, run_id, model):
    if (
        version.name != model_name
        or int(version.version) != expected
        or version.status != "READY"
        or version.model_id != model_id
        or version.run_id != run_id
        or version.tags.get("fixture") != FIXTURE_TAG
        or version.tags.get("logged_model_id") != model_id
        or version.tags.get("artifact_source") != model.artifact_location
        or version.tags.get("bootstrap_run_id") != run_id
        or version.tags.get("bootstrap_experiment_id") != experiment_id
    ):
        raise RuntimeError("Registered model version has incomplete or conflicting native provenance")
    print(f"Verified candidate version {expected}; native source: {version.source}")


def main() -> None:
    mlflow_requirement = require_supported_mlflow()
    dbutils.widgets.text("model_name", "")
    dbutils.widgets.text("experiment_id", "")
    model_name = dbutils.widgets.get("model_name")
    experiment_id = dbutils.widgets.get("experiment_id")
    if not model_name or not experiment_id:
        raise RuntimeError("Owned model and experiment references are required")

    mlflow.set_tracking_uri("databricks")
    mlflow.set_registry_uri("databricks-uc")
    client = mlflow.tracking.MlflowClient()
    registered_model = client.get_registered_model(model_name)
    experiment = client.get_experiment(experiment_id)
    if registered_model.name != model_name or experiment.experiment_id != experiment_id:
        raise RuntimeError("Owned model or experiment identity did not match its resource reference")
    if experiment.lifecycle_stage != "active" or mlflow.active_run() is not None:
        raise RuntimeError("Owned experiment must be active and no MLflow run may already be active")

    signature = ModelSignature(
        inputs=Schema([ColSpec("double")]),
        outputs=Schema([ColSpec("double")]),
    )
    runs, models, versions = read_snapshot(client, experiment_id, model_name)
    version_numbers = [int(version.version) for version in versions]
    if version_numbers not in ([], [1], [1, 2]):
        raise RuntimeError("Candidate model versions are not an allowed fixture state")

    model_id = None
    run_id = None
    model = None
    run = None
    if not versions:
        if runs or models:
            raise RuntimeError("Residual run or LoggedModel exists without versions; refusing to log again")
        os.environ["MLFLOW_LOCK_MODEL_DEPENDENCIES"] = "false"
        os.environ["MLFLOW_UV_AUTO_DETECT"] = "false"
        with mlflow.start_run(experiment_id=experiment_id, run_name="dagshund_identity_model_bootstrap") as active_run:
            logged = mlflow.pyfunc.log_model(
                name="identity_model",
                python_model=identity,
                signature=signature,
                pip_requirements=[mlflow_requirement, f"cloudpickle=={cloudpickle.__version__}"],
                tags={"fixture": FIXTURE_TAG},
            )
            model_id = logged.model_id
            run_id = active_run.info.run_id
            model = client.get_logged_model(model_id)
            if (
                not model_id
                or model.model_id != model_id
                or model.source_run_id != run_id
                or model.experiment_id != experiment_id
                or model.name != "identity_model"
                or model.status != "READY"
                or not model.artifact_location
                or logged.model_uri != f"models:/{model_id}"
            ):
                raise RuntimeError("New LoggedModel lacks expected native identity or artifact metadata")
            mlflow.set_tag("fixture", FIXTURE_TAG)
            mlflow.set_tag("fixture_model_uri", f"models:/{model_id}")
            mlflow.set_tag("fixture_model_source", model.artifact_location)
        runs, models, versions = read_snapshot(client, experiment_id, model_name)
        if len(runs) != 1 or len(models) != 1 or versions:
            raise RuntimeError("Fresh bootstrap did not produce exactly one owned run and LoggedModel")
        run = client.get_run(run_id)
    else:
        if len(runs) != 1 or len(models) != 1:
            raise RuntimeError("Existing versions lack exactly one owned run and LoggedModel")
        run_id = runs[0].info.run_id
        model_id = models[0].model_id
        model = client.get_logged_model(model_id)
        run = client.get_run(run_id)

    verify_model_and_run(client, model, run, experiment_id, model_id, run_id, signature)
    for expected in range(1, len(versions) + 1):
        verified = client.get_model_version(model_name, str(expected))
        verify_version(client, verified, model_name, expected, experiment_id, model_id, run_id, model)

    version_tags = {
        "fixture": FIXTURE_TAG,
        "logged_model_id": model_id,
        "artifact_source": model.artifact_location,
        "bootstrap_run_id": run_id,
        "bootstrap_experiment_id": experiment_id,
    }
    for expected in range(len(versions) + 1, 3):
        current_runs, current_models, current_versions = read_snapshot(client, experiment_id, model_name)
        if (
            [int(version.version) for version in current_versions] != list(range(1, expected))
            or len(current_runs) != 1
            or current_runs[0].info.run_id != run_id
            or len(current_models) != 1
            or current_models[0].model_id != model_id
        ):
            raise RuntimeError("Owned MLflow membership changed before registration; refusing to append")
        for present in current_versions:
            verified = client.get_model_version(model_name, str(present.version))
            verify_version(client, verified, model_name, int(present.version), experiment_id, model_id, run_id, model)
        created = client.create_model_version(
            name=model_name,
            source=f"models:/{model_id}",
            model_id=model_id,
            run_id=run_id,
            tags=version_tags,
            await_creation_for=300,
        )
        if created.name != model_name or int(created.version) != expected:
            raise RuntimeError(f"Expected model version {expected}, got {created.version}")
        verified = client.get_model_version(model_name, str(expected))
        verify_version(client, verified, model_name, expected, experiment_id, model_id, run_id, model)

    final_runs, final_models, final_versions = read_snapshot(client, experiment_id, model_name)
    if (
        len(final_runs) != 1
        or final_runs[0].info.run_id != run_id
        or len(final_models) != 1
        or final_models[0].model_id != model_id
        or [int(version.version) for version in final_versions] != [1, 2]
    ):
        raise RuntimeError("Final owned MLflow membership is not exactly one run, one model, and versions 1 and 2")
    for expected in (1, 2):
        verified = client.get_model_version(model_name, str(expected))
        verify_version(client, verified, model_name, expected, experiment_id, model_id, run_id, model)


main()
