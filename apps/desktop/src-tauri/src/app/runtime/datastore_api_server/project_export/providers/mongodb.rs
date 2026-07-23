use super::*;

pub(crate) static PROVIDER: MongoDbProvider = MongoDbProvider;

pub(crate) struct MongoDbProvider;

#[async_trait::async_trait]
impl ProjectExportDatastoreProvider for MongoDbProvider {
    fn engine(&self) -> &'static str {
        "mongodb"
    }

    async fn load_metadata(
        &self,
        runtime: &ManagedAppState,
        server: &DatastoreApiServerConfig,
        connection_id: &str,
    ) -> ProjectExportMetadata {
        let mut metadata = catalog_metadata(runtime, server, connection_id).await;
        for resource in server.resources.iter().filter(|resource| resource.enabled) {
            if planner::matching_structure_node(resource, &metadata.structure_nodes)
                .is_some_and(|node| node.fields.is_empty())
            {
                metadata.warnings.push(format!(
                    "MongoDB collection `{}` was empty or could not be sampled; the generated document schema remains dynamic.",
                    resource.label
                ));
            }
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
        let node = planner::matching_structure_node(resource, &metadata.structure_nodes);
        let is_compatible_kind = matches!(resource.kind.as_str(), "collection" | "table")
            && node.is_some_and(|node| matches!(node.kind.as_str(), "collection" | "view"));
        if !is_compatible_kind {
            return Ok(unsupported_resource(
                config,
                resource,
                "Only MongoDB collection resources can be exported.",
                ProjectResourceShape::Document,
            ));
        }
        let node = node.expect("compatible MongoDB resource has metadata");
        let database_name = node
            .database
            .clone()
            .filter(|value| !value.trim().is_empty())
            .or_else(|| resource_metadata_string(resource, "database"))
            .or_else(|| resource.path.first().cloned());
        let Some(database_name) = database_name else {
            return Ok(unsupported_resource(
                config,
                resource,
                format!(
                    "MongoDB resource `{}` has no physical database identity.",
                    resource.label
                ),
                ProjectResourceShape::Document,
            ));
        };
        let collection_name = node
            .object_name
            .clone()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| resource.label.clone());
        let is_view = node.is_view.unwrap_or(false) || node.kind == "view";
        let mut metadata_fields = node
            .fields
            .iter()
            .map(|field| ProjectMetadataField {
                name: field.name.clone(),
                data_type: field.data_type.clone(),
                nullable: field.nullable.unwrap_or(true),
                primary: field.name == "_id",
            })
            .collect::<Vec<_>>();
        if !metadata_fields.iter().any(|field| field.name == "_id") {
            metadata_fields.insert(
                0,
                ProjectMetadataField {
                    name: "_id".into(),
                    data_type: "value".into(),
                    nullable: false,
                    primary: true,
                },
            );
        }
        let fields = project_fields(metadata_fields);
        let mut primary_fields = fields
            .iter()
            .filter(|field| field.primary)
            .cloned()
            .collect::<Vec<_>>();
        if is_view {
            primary_fields.clear();
        }
        let (mode, reason) = if is_view {
            (
                ProjectResourceMode::ReadOnly,
                Some("MongoDB views are exported with list-only routes.".into()),
            )
        } else {
            (ProjectResourceMode::Crud, None)
        };
        let sample_status = if node.fields.is_empty() {
            "empty-or-unavailable"
        } else {
            "sampled"
        };
        Ok(ProjectResourceModel {
            id: resource.id.clone(),
            label: resource.label.clone(),
            kind: "collection".into(),
            endpoint_slug: resource.endpoint_slug.clone(),
            endpoint_path: configured_resource_endpoint(config, resource),
            model_name: pascal_case(&resource.endpoint_slug),
            shape: ProjectResourceShape::Document,
            schema_source: "sample".into(),
            schema_source_label: "MongoDB bounded document sample".into(),
            database_name: Some(database_name.clone()),
            schema_name: None,
            table_name: collection_name.clone(),
            qualified_target: format!("{database_name}.{collection_name}"),
            identity_format: if is_view {
                "none"
            } else {
                "scalar-or-_id-object"
            }
            .into(),
            json_format: Some("mongodb-extended-json".into()),
            sample_status: Some(sample_status.into()),
            mode,
            capability_reason: reason,
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
            "api-server-export-custom-endpoint-mongodb-unsupported",
            "MongoDB custom endpoints are not supported by project export; export collection resources instead.",
        ))
    }
}

fn resource_metadata_string(
    resource: &DatastoreApiServerResourceConfig,
    key: &str,
) -> Option<String> {
    resource
        .metadata
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}
