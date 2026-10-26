# Synthetic AI Gateway plan

`plan.json` is a constructed, secret-free input for existing Python and JavaScript fixture consumers. It is not a CLI-generated plan, a workspace capture, or evidence that DAB accepts or deploys these resources. The `cli_version` identifies the schema and serialization contract targeted by the example; it does not identify a generating CLI run.

## Coverage

- Three AI Gateway service kinds under the same fictional Unity Catalog schema: model-provider services, a model service, and an MCP service. The plan contains two provider resources.
- A model-service primary route to the custom provider service, plus fallback references to a UC model and a serving endpoint.
- A second, unreferenced provider service demonstrates a source-supported Bedrock service-credential reference.
- An MCP service with an explicit UC connection reference.
- An Amazon Bedrock UC service-credential reference using the schema-supported `credentials/{name}` form. The name and credential are fictional; no credential value is present.
- Service grant subresources, multiple grant entries, and delayed `vars.full_name` references.

All identities are fictional. The custom provider URL uses the reserved `.invalid` domain. No resource has a `before/` or `after/` deployment configuration. These references do not contact providers or verify that the named UC connection, model, endpoint, or service credential exists.

## Provenance

- Target schema: Databricks CLI v1.20.0 output from `databricks bundle schema`; the service and provider fields are checked against that local generated schema. The schema defines bundle inputs, not backend acceptance or emitted plan behavior.
- Source version: Databricks CLI v1.20.0: [`plan.go`](https://github.com/databricks/cli/blob/v1.20.0/bundle/deployplan/plan.go), [`bundle_plan.go`](https://github.com/databricks/cli/blob/v1.20.0/bundle/direct/bundle_plan.go), and the [`model_service`](https://github.com/databricks/cli/blob/v1.20.0/bundle/direct/dresources/model_service.go), [`model_provider_service`](https://github.com/databricks/cli/blob/v1.20.0/bundle/direct/dresources/model_provider_service.go), and [`mcp_service`](https://github.com/databricks/cli/blob/v1.20.0/bundle/direct/dresources/mcp_service.go) adapters. These define the plan envelope, state/change serialization, and resource IDs used by the constructed plan.
- SDK version: v0.185.0, pinned by CLI v1.20.0; [`service/catalog/model.go`](https://github.com/databricks/databricks-sdk-go/blob/v0.185.0/service/catalog/model.go) supplies the UC service-credential reference types. This does not prove that an external credential exists or that the backend accepts this plan.
- Grant shape: upstream v1.20.0 acceptance plans for [`model_services`](https://github.com/databricks/cli/blob/v1.20.0/acceptance/bundle/resources/grants/model_services/out.plan1.json), [`model_provider_services`](https://github.com/databricks/cli/blob/v1.20.0/acceptance/bundle/resources/grants/model_provider_services/out.plan1.json), and [`mcp_services`](https://github.com/databricks/cli/blob/v1.20.0/acceptance/bundle/resources/grants/mcp_services/out.plan1.json). The fixture borrows the grant subresource envelope and delayed `vars.full_name` pattern. It does not represent an upstream observation as a local capture.

The plan envelope and resource values are deliberately constructed from these sources. This fixture does not assert backend normalization, DAB runtime acceptance, deployment success, inference lifecycle, or service availability. Provider UC-secret references, unresolved app `CONNECTION` resolution, and derived inference outputs remain deferred.
