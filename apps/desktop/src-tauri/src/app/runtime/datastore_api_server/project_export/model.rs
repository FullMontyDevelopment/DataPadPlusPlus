use super::*;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ProjectResourceMode {
    Crud,
    ReadOnly,
    Unsupported,
}

impl ProjectResourceMode {
    pub(crate) fn id(self) -> &'static str {
        match self {
            Self::Crud => "crud",
            Self::ReadOnly => "read-only",
            Self::Unsupported => "unsupported",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ProjectResourceShape {
    Relational,
    Document,
    KeyedDocument,
}

impl ProjectResourceShape {
    pub(crate) fn id(self) -> &'static str {
        match self {
            Self::Relational => "relational",
            Self::Document => "document",
            Self::KeyedDocument => "keyed-document",
        }
    }

    pub(crate) fn is_document(self) -> bool {
        matches!(self, Self::Document | Self::KeyedDocument)
    }
}

#[derive(Clone)]
pub(crate) struct ProjectExportSpec {
    pub(crate) framework: String,
    pub(crate) project_name: String,
    pub(crate) namespace: String,
    pub(crate) package_name: String,
    pub(crate) protocol: String,
    pub(crate) base_path: String,
    pub(crate) connection_engine: String,
    pub(crate) connection_family: String,
    pub(crate) adapter_id: String,
    pub(crate) client_label: String,
    pub(crate) configuration_key: String,
    pub(crate) configuration_example: String,
    pub(crate) additional_configuration: Vec<(String, String)>,
    pub(crate) safety_note: String,
    pub(crate) rust_version: String,
    pub(crate) resources: Vec<ProjectResourceModel>,
    pub(crate) custom_endpoints: Vec<ProjectCustomEndpoint>,
    pub(crate) dependencies: Vec<ProjectDependency>,
    pub(crate) warnings: Vec<String>,
}

#[derive(Clone)]
pub(crate) struct ProjectResourceModel {
    pub(crate) id: String,
    pub(crate) label: String,
    pub(crate) kind: String,
    pub(crate) endpoint_slug: String,
    pub(crate) endpoint_path: String,
    pub(crate) model_name: String,
    pub(crate) shape: ProjectResourceShape,
    pub(crate) schema_source: String,
    pub(crate) schema_source_label: String,
    pub(crate) database_name: Option<String>,
    pub(crate) schema_name: Option<String>,
    pub(crate) table_name: String,
    pub(crate) qualified_target: String,
    pub(crate) identity_format: String,
    pub(crate) json_format: Option<String>,
    pub(crate) sample_status: Option<String>,
    pub(crate) mode: ProjectResourceMode,
    pub(crate) capability_reason: Option<String>,
    pub(crate) fields: Vec<ProjectFieldModel>,
    pub(crate) primary_fields: Vec<ProjectFieldModel>,
}

#[derive(Clone)]
pub(crate) struct ProjectFieldModel {
    pub(crate) source_name: String,
    pub(crate) rust_name: String,
    pub(crate) csharp_name: String,
    pub(crate) json_name: String,
    pub(crate) rust_base_type: String,
    pub(crate) rust_type: String,
    pub(crate) csharp_base_type: String,
    pub(crate) csharp_type: String,
    pub(crate) data_type: String,
    pub(crate) nullable: bool,
    pub(crate) primary: bool,
    pub(crate) writable: bool,
}

#[derive(Clone)]
pub(crate) struct ProjectCustomEndpoint {
    pub(crate) id: String,
    pub(crate) label: String,
    pub(crate) method: String,
    pub(crate) endpoint_path: String,
    pub(crate) function_name: String,
    pub(crate) original_query: String,
    pub(crate) parameterized_query: String,
    pub(crate) row_limit: u32,
    pub(crate) parameters: Vec<ProjectEndpointParameter>,
}

#[derive(Clone)]
pub(crate) struct ProjectEndpointParameter {
    pub(crate) name: String,
    pub(crate) parameter_type: String,
    pub(crate) rust_type: String,
    pub(crate) required: bool,
}

#[derive(Clone)]
pub(crate) struct ProjectDependency {
    pub(crate) package: String,
    pub(crate) version: String,
    pub(crate) declaration: String,
    pub(crate) build: bool,
}

pub(crate) struct ProjectFile {
    pub(crate) path: String,
    pub(crate) contents: String,
}

pub(crate) struct ProjectExportClientAdapter {
    pub(crate) id: &'static str,
    pub(crate) framework: &'static str,
    pub(crate) engine: &'static str,
    pub(crate) client_label: &'static str,
    pub(crate) configuration_key: &'static str,
    pub(crate) configuration_example: &'static str,
    pub(crate) additional_configuration: &'static [(&'static str, &'static str)],
    pub(crate) safety_note: &'static str,
    pub(crate) rust_version: &'static str,
    pub(crate) sql: Option<ProjectExportSqlClientHooks>,
    pub(crate) dependencies: fn(&ProjectExportSpec) -> Vec<ProjectDependency>,
    pub(crate) render_client_files:
        fn(&ProjectExportSpec, &ProjectExportClientAdapter) -> Vec<ProjectFile>,
}

#[derive(Clone, Copy)]
pub(crate) struct ProjectExportSqlClientHooks {
    pub(crate) supports_schema: bool,
    pub(crate) batch_dialect: crate::adapters::SqlBatchDialect,
    pub(crate) quote_identifier: fn(&str) -> Result<String, CommandError>,
    pub(crate) select_expression: fn(&str, &str, bool) -> Result<String, CommandError>,
    pub(crate) parameter_placeholder: fn(usize) -> String,
}

pub(crate) struct ProjectExportFrameworkRenderer {
    pub(crate) framework: &'static str,
    pub(crate) dependencies: fn(&ProjectExportSpec) -> Vec<ProjectDependency>,
    pub(crate) render: fn(&ProjectExportSpec, &ProjectExportClientAdapter) -> Vec<ProjectFile>,
}

#[derive(Clone, Default)]
pub(crate) struct ProjectExportMetadata {
    pub(crate) structure_nodes: Vec<StructureNode>,
    pub(crate) keyed_documents: HashMap<String, ProjectKeyedDocumentMetadata>,
    pub(crate) warnings: Vec<String>,
}

#[derive(Clone)]
pub(crate) struct ProjectKeyedDocumentMetadata {
    pub(crate) table_name: String,
    pub(crate) fields: Vec<ProjectMetadataField>,
    pub(crate) sample_status: String,
}

#[derive(Clone)]
pub(crate) struct ProjectMetadataField {
    pub(crate) name: String,
    pub(crate) data_type: String,
    pub(crate) nullable: bool,
    pub(crate) primary: bool,
}

#[async_trait::async_trait]
pub(crate) trait ProjectExportDatastoreProvider: Sync {
    fn engine(&self) -> &'static str;

    async fn load_metadata(
        &self,
        runtime: &ManagedAppState,
        server: &DatastoreApiServerConfig,
        connection_id: &str,
    ) -> ProjectExportMetadata;

    fn plan_resource(
        &self,
        config: &DatastoreApiServerConfig,
        resource: &DatastoreApiServerResourceConfig,
        metadata: &ProjectExportMetadata,
        adapter: &ProjectExportClientAdapter,
    ) -> Result<ProjectResourceModel, CommandError>;

    fn plan_custom_endpoint(
        &self,
        config: &DatastoreApiServerConfig,
        endpoint: &DatastoreApiServerCustomEndpointConfig,
        adapter: &ProjectExportClientAdapter,
    ) -> Result<ProjectCustomEndpoint, CommandError>;
}
