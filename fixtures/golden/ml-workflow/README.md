# ML validation and serving workflow

This deployable fixture illustrates a model validation workflow and a managed
serving-version change. It owns all of its schemas, model containers, experiment
resources, job definitions, bootstrap run, and endpoint under the existing
`dagshund` catalog. The training volume is intentionally empty. The baseline
registered-model container is intentionally empty in both states.

## Before and after

- **Before:** candidate model version 1 is served. The illustrative workflow
  shows loading and validation, feature preparation, splitting, candidate
  training and evaluation, promotion, and serving checks. It sets
  `learning_rate` to `0.1`.
- **After:** the workflow adds parallel baseline and candidate branches,
  comparison, a condition gate, promotion on the true outcome, and serving
  checks. It changes `learning_rate` to `0.05`, serves candidate version 2, and
  grants the existing `data_analysts` group registry-schema `USE_SCHEMA`, model
  `EXECUTE`, and endpoint `CAN_QUERY` permissions.

The workflow tasks are placeholders and are never run by fixture regeneration.
They do not train, evaluate, read data, or produce lineage. The empty volume
and two Workspace experiments are owned resources, not evidence of training
or validation data.

## Bootstrap and artifact

The one unchanged `seed_model_versions` job run is the only fixture job that
runs during a deployment. It targets the already-owned candidate registered
model and training experiment through bundle resource references. The notebook requires the preinstalled MLflow module to be exactly 3.12.0 and
checks the needed public API signatures before tracking or model writes. It logs
one identity callable with an explicit input/output signature, no input example,
and explicit metadata for the already-installed MLflow and cloudpickle versions.
It registers the same LoggedModel as candidate versions 1 and 2. Native model
and run IDs, experiment ownership, stored signature, READY status, and fixture
markers are verified independently; version source URIs are recorded, not
compared as if they named the same storage location. Bounded run/model/version
membership checks allow only a fresh state, verified version 1, or verified
versions 1 and 2. Residual or uncertain state stops without relogging or
replaying a registration. The notebook does not call the model, train, query
SQL, process volume data, or install packages.

The after-state keeps the bootstrap definition unchanged, so a successful
existing run is skipped. Its native run-state reference on the endpoint is
intended to order endpoint creation after successful bootstrap completion. It
is not an endpoint `depends_on` setting. If a failed or uncertain bootstrap
attempt leaves partial metadata, inspect the owned versions and artifact before
retrying; never assume the next version number or blindly append versions.

The checked-in plan is the genuine unchanged-generator CLI 1.20.0 capture from
normal cycle 1249 (SHA-256 `eb339ee80a24decd9132145f92ac6c98c60d67e7b9914762a7ffe53c1fe91318`). Its native bootstrap run succeeded and independently verified one signature-bearing logged model, registered candidate versions 1 and 2, READY model versions, run/model linkage, and provenance. The normal lifecycle captured the after plan between before deployment and after deployment, then destroyed the fixture-owned resources.

The before capture records endpoint readiness in the nested `remote_state.endpoint_details.state` fields (`config_update: NOT_UPDATING`, `ready: READY`) and `DEPLOYMENT_READY` entities. This baseline snapshot does not establish post-update readiness or inference behavior: there was no endpoint query or prediction. Teardown verification confirmed owned resources absent by name. MLflow run/artifact metadata remains retained and experiments are soft-deleted; no physical artifact purge is claimed. See `fixtures/COVERAGE.md` for the exact capture and consumer-test evidence.

## Cleanup limits

Destroy removes the fixture-owned endpoint and bundle resources. Model-version
and experiment artifact retention is service-managed; fixture teardown does not
purge external storage or guarantee artifact deletion. Confirm cleanup against
fresh actual resource identities after a live run. Do not delete external
resources or infer cleanup success from a local plan.
