use std::collections::BTreeMap;

use super::*;

pub(crate) static PROVIDER: DynamoDbProvider = DynamoDbProvider;

pub(crate) struct DynamoDbProvider;

#[async_trait::async_trait]
impl ProjectExportDatastoreProvider for DynamoDbProvider {
    fn engine(&self) -> &'static str {
        "dynamodb"
    }

    async fn load_metadata(
        &self,
        runtime: &ManagedAppState,
        server: &DatastoreApiServerConfig,
        connection_id: &str,
    ) -> ProjectExportMetadata {
        let Some(environment_id) = server.environment_id.as_deref() else {
            return ProjectExportMetadata::default();
        };
        let mut metadata = ProjectExportMetadata::default();
        for resource in server.resources.iter().filter(|resource| resource.enabled) {
            if !matches!(resource.kind.as_str(), "table" | "item") {
                continue;
            }
            let table_name = dynamodb_table_name(resource);
            metadata.warnings.push(format!(
                "DynamoDB list route for table `{table_name}` uses one bounded, non-consistent Scan and consumes table read capacity."
            ));
            let inspection = runtime
                .inspect_explorer_node(crate::domain::models::ExplorerInspectRequest {
                    connection_id: connection_id.into(),
                    environment_id: environment_id.into(),
                    node_id: format!("items:{table_name}"),
                })
                .await;
            let Ok(inspection) = inspection else {
                metadata.warnings.push(format!(
                    "DynamoDB metadata could not be loaded for table `{table_name}`."
                ));
                continue;
            };
            let payload = inspection.payload.unwrap_or(Value::Null);
            let fields = dynamodb_metadata_fields(&payload);
            if !fields.iter().any(|field| field.primary) {
                metadata.warnings.push(format!(
                    "DynamoDB table `{table_name}` did not return a partition-key schema."
                ));
                continue;
            }
            let sample_status = if payload
                .get("items")
                .and_then(Value::as_array)
                .is_some_and(|items| !items.is_empty())
            {
                "sampled"
            } else {
                "empty-or-unavailable"
            };
            if sample_status != "sampled" {
                metadata.warnings.push(format!(
                    "DynamoDB table `{table_name}` had no readable sample items; generated GraphQL fields are limited to the key schema."
                ));
            }
            metadata.keyed_documents.insert(
                metadata_key(resource),
                ProjectKeyedDocumentMetadata {
                    table_name,
                    fields,
                    sample_status: sample_status.into(),
                },
            );
        }
        metadata
    }

    fn plan_resource(
        &self,
        config: &DatastoreApiServerConfig,
        resource: &DatastoreApiServerResourceConfig,
        metadata: &ProjectExportMetadata,
        _adapter: &ProjectExportClientAdapter,
    ) -> Result<ProjectResourceModel, CommandError> {
        if !matches!(resource.kind.as_str(), "table" | "item") {
            return Ok(unsupported_resource(
                config,
                resource,
                "Only DynamoDB table and item resources can be exported.",
                ProjectResourceShape::KeyedDocument,
            ));
        }
        let Some(metadata) = metadata.keyed_documents.get(&metadata_key(resource)) else {
            return Ok(unsupported_resource(
                config,
                resource,
                format!(
                    "DynamoDB resource `{}` has no complete partition-key metadata.",
                    resource.label
                ),
                ProjectResourceShape::KeyedDocument,
            ));
        };
        let fields = project_fields(metadata.fields.clone());
        let primary_fields = fields
            .iter()
            .filter(|field| field.primary)
            .cloned()
            .collect::<Vec<_>>();
        Ok(ProjectResourceModel {
            id: resource.id.clone(),
            label: resource.label.clone(),
            kind: "item".into(),
            endpoint_slug: resource.endpoint_slug.clone(),
            endpoint_path: configured_resource_endpoint(config, resource),
            model_name: pascal_case(&resource.endpoint_slug),
            shape: ProjectResourceShape::KeyedDocument,
            schema_source: "describe-table-and-sample".into(),
            schema_source_label: "DynamoDB key schema and bounded item sample".into(),
            database_name: None,
            schema_name: None,
            table_name: metadata.table_name.clone(),
            qualified_target: metadata.table_name.clone(),
            identity_format: "exact-key-object".into(),
            json_format: Some("dynamodb-lossless-document-json".into()),
            sample_status: Some(metadata.sample_status.clone()),
            mode: ProjectResourceMode::Crud,
            capability_reason: None,
            fields,
            primary_fields,
        })
    }

    fn plan_custom_endpoint(
        &self,
        _config: &DatastoreApiServerConfig,
        _endpoint: &DatastoreApiServerCustomEndpointConfig,
        _adapter: &ProjectExportClientAdapter,
    ) -> Result<ProjectCustomEndpoint, CommandError> {
        Err(CommandError::new(
            "api-server-export-custom-endpoint-dynamodb-unsupported",
            "DynamoDB custom endpoints are not supported by project export; export table resources instead.",
        ))
    }
}

fn dynamodb_table_name(resource: &DatastoreApiServerResourceConfig) -> String {
    resource
        .metadata
        .get("table")
        .or_else(|| resource.metadata.get("tableName"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .or_else(|| {
            resource
                .node_id
                .strip_prefix("table:")
                .or_else(|| resource.node_id.strip_prefix("items:"))
                .map(str::to_string)
        })
        .unwrap_or_else(|| resource.label.clone())
}

fn dynamodb_metadata_fields(payload: &Value) -> Vec<ProjectMetadataField> {
    let mut fields = BTreeMap::<String, ProjectMetadataField>::new();
    for key in payload
        .get("keys")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let Some(name) = key.get("attribute").and_then(Value::as_str) else {
            continue;
        };
        fields.insert(
            name.into(),
            ProjectMetadataField {
                name: name.into(),
                data_type: key
                    .get("attributeType")
                    .and_then(Value::as_str)
                    .unwrap_or("value")
                    .into(),
                nullable: false,
                primary: true,
            },
        );
    }
    let items = payload
        .get("items")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let total = items.len();
    let mut present = BTreeMap::<String, usize>::new();
    for item in &items {
        let Some(item) = item.as_object() else {
            continue;
        };
        for (name, value) in item {
            *present.entry(name.clone()).or_default() += 1;
            let data_type = dynamodb_attribute_type(value);
            fields
                .entry(name.clone())
                .and_modify(|field| {
                    if field.data_type != data_type && !field.primary {
                        field.data_type = "value".into();
                    }
                })
                .or_insert(ProjectMetadataField {
                    name: name.clone(),
                    data_type,
                    nullable: true,
                    primary: false,
                });
        }
    }
    for field in fields.values_mut().filter(|field| !field.primary) {
        field.nullable = present.get(&field.name).copied().unwrap_or_default() < total;
    }
    fields.into_values().collect()
}

fn dynamodb_attribute_type(value: &Value) -> String {
    value
        .as_object()
        .and_then(|object| object.keys().next())
        .map(|key| match key.as_str() {
            "S" => "string",
            "N" => "number",
            "B" => "binary",
            "BOOL" => "boolean",
            "NULL" => "null",
            "M" => "document",
            "L" => "array",
            "SS" => "stringSet",
            "NS" => "numberSet",
            "BS" => "binarySet",
            _ => "value",
        })
        .unwrap_or("value")
        .into()
}
