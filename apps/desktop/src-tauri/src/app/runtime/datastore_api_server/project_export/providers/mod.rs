use super::*;

mod dynamodb;
mod mongodb;
mod relational;

pub(crate) use dynamodb::PROVIDER as DYNAMODB;
pub(crate) use mongodb::PROVIDER as MONGODB;
pub(crate) use relational::{POSTGRESQL, SQLITE};

pub(super) async fn catalog_metadata(
    runtime: &ManagedAppState,
    server: &DatastoreApiServerConfig,
    connection_id: &str,
) -> ProjectExportMetadata {
    let mut warnings = Vec::new();
    let structure_nodes =
        planner::load_export_structure(runtime, server, connection_id, &mut warnings).await;
    ProjectExportMetadata {
        structure_nodes,
        warnings,
        ..ProjectExportMetadata::default()
    }
}

pub(super) fn metadata_key(resource: &DatastoreApiServerResourceConfig) -> String {
    [
        resource.node_id.as_str(),
        resource.label.as_str(),
        resource.endpoint_slug.as_str(),
        resource.scope.as_deref().unwrap_or_default(),
    ]
    .into_iter()
    .map(str::trim)
    .filter(|value| !value.is_empty())
    .collect::<Vec<_>>()
    .join("\u{1f}")
    .to_ascii_lowercase()
}

pub(super) fn unsupported_resource(
    config: &DatastoreApiServerConfig,
    resource: &DatastoreApiServerResourceConfig,
    reason: impl Into<String>,
    shape: ProjectResourceShape,
) -> ProjectResourceModel {
    ProjectResourceModel {
        id: resource.id.clone(),
        label: resource.label.clone(),
        kind: resource.kind.clone(),
        endpoint_slug: resource.endpoint_slug.clone(),
        endpoint_path: configured_resource_endpoint(config, resource),
        model_name: pascal_case(&resource.endpoint_slug),
        shape,
        schema_source: "unavailable".into(),
        schema_source_label: "Unavailable".into(),
        database_name: None,
        schema_name: None,
        table_name: resource.label.clone(),
        qualified_target: String::new(),
        identity_format: "unavailable".into(),
        json_format: shape.is_document().then(|| "document-json".into()),
        sample_status: None,
        mode: ProjectResourceMode::Unsupported,
        capability_reason: Some(reason.into()),
        fields: Vec::new(),
        primary_fields: Vec::new(),
    }
}

pub(super) fn project_fields(
    fields: impl IntoIterator<Item = ProjectMetadataField>,
) -> Vec<ProjectFieldModel> {
    let mut seen_rust = HashMap::from([("document".to_string(), 1_usize)]);
    let mut seen_csharp = HashMap::from([("Document".to_string(), 1_usize)]);
    fields
        .into_iter()
        .filter(|field| !field.name.trim().is_empty())
        .map(|field| {
            let source_name = field.name.trim().to_string();
            let (rust_base_type, csharp_base_type, writable) =
                document_field_type(&field.data_type);
            let rust_name = unique_identifier(&mut seen_rust, snake_case(&source_name), "field");
            let csharp_name =
                unique_identifier(&mut seen_csharp, pascal_case(&source_name), "Field");
            ProjectFieldModel {
                source_name: source_name.clone(),
                rust_name,
                csharp_name,
                json_name: source_name,
                rust_base_type: rust_base_type.into(),
                rust_type: format!("Option<{rust_base_type}>"),
                csharp_base_type: csharp_base_type.into(),
                csharp_type: format!("{csharp_base_type}?"),
                data_type: field.data_type,
                nullable: field.nullable,
                primary: field.primary,
                writable,
            }
        })
        .collect()
}

fn document_field_type(data_type: &str) -> (&'static str, &'static str, bool) {
    match data_type.trim().to_ascii_lowercase().as_str() {
        "string" | "s" => ("String", "string", true),
        "boolean" | "bool" => ("bool", "bool", true),
        "int32" => ("i32", "int", true),
        "int64" => ("i64", "long", true),
        "double" => ("f64", "double", true),
        _ => (
            "async_graphql::Json<serde_json::Value>",
            "System.Text.Json.JsonElement",
            true,
        ),
    }
}
