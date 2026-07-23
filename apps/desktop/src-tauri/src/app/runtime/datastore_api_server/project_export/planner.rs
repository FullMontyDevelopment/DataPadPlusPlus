use std::collections::{HashMap, HashSet};

use super::*;

const SUPPORTED_PROTOCOLS: [&str; 3] = ["rest", "graphql", "grpc"];

pub(crate) async fn build_project_export_capabilities(
    runtime: &mut ManagedAppState,
    request: DatastoreApiServerProjectExportCapabilitiesRequest,
) -> Result<DatastoreApiServerProjectExportCapabilitiesResponse, CommandError> {
    runtime.ensure_unlocked()?;
    let server = normalized_servers(&runtime.snapshot.preferences.datastore_api_server)
        .into_iter()
        .find(|server| server.id == request.server_id)
        .ok_or_else(|| {
            CommandError::new(
                "api-server-not-found",
                "The requested API server configuration could not be found.",
            )
        })?;
    let Some(connection_id) = server.connection_id.as_deref() else {
        return Ok(capabilities_without_connection(&server));
    };
    let connection = runtime.connection_by_id(connection_id)?;
    let provider = datastore_provider_for(&connection.engine).ok();
    let metadata = if let Some(provider) = provider {
        provider
            .load_metadata(runtime, &server, connection_id)
            .await
    } else {
        ProjectExportMetadata::default()
    };

    let mut frameworks = Vec::new();
    for framework in ["rust", "dotnet"] {
        let adapter = match client_adapter_for(framework, &connection.engine) {
            Ok(adapter) => adapter,
            Err(error) => {
                frameworks.push(DatastoreApiServerProjectExportFrameworkCapability {
                    framework: framework.into(),
                    supported: false,
                    client: String::new(),
                    protocols: Vec::new(),
                    reason: Some(error.message),
                    resources: server
                        .resources
                        .iter()
                        .filter(|resource| resource.enabled)
                        .map(
                            |resource| DatastoreApiServerProjectExportResourceCapability {
                                resource_id: resource.id.clone(),
                                mode: ProjectResourceMode::Unsupported.id().into(),
                                reason: Some(
                                    "This datastore does not have a project-export client adapter."
                                        .into(),
                                ),
                            },
                        )
                        .collect(),
                    custom_endpoints: server
                        .custom_endpoints
                        .iter()
                        .filter(|endpoint| endpoint.enabled)
                        .map(
                            |endpoint| DatastoreApiServerProjectExportEndpointCapability {
                                endpoint_id: endpoint.id.clone(),
                                supported: false,
                                reason: Some(
                                    "This datastore does not have a project-export client adapter."
                                        .into(),
                                ),
                            },
                        )
                        .collect(),
                    warnings: Vec::new(),
                });
                continue;
            }
        };

        let resources = server
            .resources
            .iter()
            .filter(|resource| resource.enabled)
            .map(|resource| {
                let planned = provider
                    .expect("supported client has a datastore provider")
                    .plan_resource(&server, resource, &metadata, adapter);
                match planned {
                    Ok(resource) => DatastoreApiServerProjectExportResourceCapability {
                        resource_id: resource.id,
                        mode: resource.mode.id().into(),
                        reason: resource.capability_reason,
                    },
                    Err(error) => DatastoreApiServerProjectExportResourceCapability {
                        resource_id: resource.id.clone(),
                        mode: ProjectResourceMode::Unsupported.id().into(),
                        reason: Some(error.message),
                    },
                }
            })
            .collect();
        let custom_endpoints = server
            .custom_endpoints
            .iter()
            .filter(|endpoint| endpoint.enabled)
            .map(|endpoint| {
                match provider
                    .expect("supported client has a datastore provider")
                    .plan_custom_endpoint(&server, endpoint, adapter)
                {
                    Ok(_) => DatastoreApiServerProjectExportEndpointCapability {
                        endpoint_id: endpoint.id.clone(),
                        supported: true,
                        reason: None,
                    },
                    Err(error) => DatastoreApiServerProjectExportEndpointCapability {
                        endpoint_id: endpoint.id.clone(),
                        supported: false,
                        reason: Some(error.message),
                    },
                }
            })
            .collect();

        let configuration_reason = server
            .environment_id
            .as_ref()
            .filter(|id| !id.is_empty())
            .map_or(
                Some("Choose an environment before exporting this API server project.".into()),
                |_| None,
            );
        frameworks.push(DatastoreApiServerProjectExportFrameworkCapability {
            framework: framework.into(),
            supported: configuration_reason.is_none(),
            client: adapter.client_label.into(),
            protocols: SUPPORTED_PROTOCOLS
                .iter()
                .map(|value| (*value).into())
                .collect(),
            reason: configuration_reason,
            resources,
            custom_endpoints,
            warnings: metadata.warnings.clone(),
        });
    }

    Ok(DatastoreApiServerProjectExportCapabilitiesResponse {
        server_id: server.id,
        engine: connection.engine,
        frameworks,
    })
}

pub(crate) async fn build_project_export_spec(
    runtime: &mut ManagedAppState,
    server: &DatastoreApiServerConfig,
    connection: &crate::domain::models::ConnectionProfile,
    framework: String,
    project_name: String,
    namespace: String,
    package_name: String,
) -> Result<ProjectExportSpec, CommandError> {
    let adapter = client_adapter_for(&framework, &connection.engine)?;
    let renderer = framework_renderer_for(&framework)?;
    let provider = datastore_provider_for(&connection.engine)?;
    let connection_id = server.connection_id.as_deref().ok_or_else(|| {
        CommandError::new(
            "api-server-export-connection-required",
            "Choose a datastore before exporting this API server project.",
        )
    })?;
    if server
        .environment_id
        .as_deref()
        .is_none_or(|environment_id| environment_id.is_empty())
    {
        return Err(CommandError::new(
            "api-server-export-environment-required",
            "Choose an environment before exporting this API server project.",
        ));
    }

    let resources = server
        .resources
        .iter()
        .filter(|resource| resource.enabled)
        .collect::<Vec<_>>();
    let endpoints = server
        .custom_endpoints
        .iter()
        .filter(|endpoint| endpoint.enabled)
        .collect::<Vec<_>>();
    if resources.is_empty() && endpoints.is_empty() {
        return Err(CommandError::new(
            "api-server-export-empty",
            "Add at least one enabled resource or custom endpoint before exporting this project.",
        ));
    }

    let metadata = provider.load_metadata(runtime, server, connection_id).await;
    let warnings = metadata.warnings.clone();
    let resource_models = resources
        .into_iter()
        .map(|resource| provider.plan_resource(server, resource, &metadata, adapter))
        .collect::<Result<Vec<_>, _>>()?;
    if let Some(resource) = resource_models
        .iter()
        .find(|resource| resource.mode == ProjectResourceMode::Unsupported)
    {
        return Err(CommandError::new(
            "api-server-export-resource-unsupported",
            resource
                .capability_reason
                .clone()
                .unwrap_or_else(|| format!("Resource `{}` cannot be exported.", resource.label)),
        ));
    }
    let custom_endpoints = endpoints
        .into_iter()
        .map(|endpoint| provider.plan_custom_endpoint(server, endpoint, adapter))
        .collect::<Result<Vec<_>, _>>()?;

    let mut spec = ProjectExportSpec {
        framework,
        project_name,
        namespace,
        package_name,
        protocol: normalize_protocol(&server.protocol),
        base_path: normalize_base_path(&server.base_path),
        connection_engine: connection.engine.clone(),
        connection_family: connection.family.clone(),
        adapter_id: adapter.id.into(),
        client_label: adapter.client_label.into(),
        configuration_key: adapter.configuration_key.into(),
        configuration_example: adapter.configuration_example.into(),
        additional_configuration: adapter
            .additional_configuration
            .iter()
            .map(|(key, value)| ((*key).into(), (*value).into()))
            .collect(),
        safety_note: adapter.safety_note.into(),
        rust_version: adapter.rust_version.into(),
        resources: resource_models,
        custom_endpoints,
        dependencies: Vec::new(),
        warnings,
    };
    spec.dependencies.extend((renderer.dependencies)(&spec));
    spec.dependencies.extend((adapter.dependencies)(&spec));
    spec.dependencies.sort_by(|left, right| {
        left.build
            .cmp(&right.build)
            .then_with(|| left.package.cmp(&right.package))
    });
    spec.dependencies
        .dedup_by(|left, right| left.package == right.package && left.build == right.build);
    spec.warnings.sort();
    spec.warnings.dedup();
    Ok(spec)
}

pub(crate) fn project_resource_model(
    config: &DatastoreApiServerConfig,
    resource: &DatastoreApiServerResourceConfig,
    nodes: &[StructureNode],
    adapter: &ProjectExportClientAdapter,
) -> Result<ProjectResourceModel, CommandError> {
    if resource.kind != "table" {
        return Ok(unsupported_resource(
            config,
            resource,
            "Only table resources can be exported as PostgreSQL or SQLite clients.",
        ));
    }
    let Some(node) = matching_structure_node(resource, nodes) else {
        return Ok(unsupported_resource(
            config,
            resource,
            &format!(
                "Resource `{}` has no catalog field metadata. Refresh the structure map before exporting.",
                resource.label
            ),
        ));
    };
    if node.fields.is_empty() {
        return Ok(unsupported_resource(
            config,
            resource,
            &format!(
                "Resource `{}` has no catalog fields and cannot produce a typed client.",
                resource.label
            ),
        ));
    }

    let table_name = node
        .object_name
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(&resource.label)
        .trim()
        .to_string();
    let sql = adapter.sql.ok_or_else(|| {
        CommandError::new(
            "api-server-export-client-shape-invalid",
            "The selected project-export client cannot plan relational resources.",
        )
    })?;
    let schema_name = if sql.supports_schema {
        physical_schema(resource, node)
    } else {
        None
    };
    let database_name = node
        .database
        .clone()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| {
            resource
                .metadata
                .get("database")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
        });
    let quoted_table = (sql.quote_identifier)(&table_name)?;
    let qualified_target = if let Some(schema) = &schema_name {
        format!("{}.{}", (sql.quote_identifier)(schema)?, quoted_table)
    } else {
        quoted_table
    };
    let fields = project_field_models(&node.fields);
    let mut primary_fields = fields
        .iter()
        .filter(|field| field.primary)
        .cloned()
        .collect::<Vec<_>>();
    let is_view = node.is_view.unwrap_or(false)
        || node.kind.to_ascii_lowercase().contains("view")
        || resource
            .detail
            .as_deref()
            .is_some_and(|detail| detail.to_ascii_lowercase().contains("view"));
    if is_view {
        primary_fields.clear();
    }
    let non_writable_type = fields.iter().any(|field| !field.writable);
    let writable_non_key = fields.iter().any(|field| field.writable && !field.primary);
    let (mode, capability_reason) = if is_view {
        (
            ProjectResourceMode::ReadOnly,
            Some("Views are exported with list-only routes.".into()),
        )
    } else if primary_fields.is_empty() {
        (
            ProjectResourceMode::ReadOnly,
            Some("Keyless resources are exported with list-only routes.".into()),
        )
    } else if non_writable_type {
        (
            ProjectResourceMode::ReadOnly,
            Some(
                "One or more database-specific field types are cast to text for reads, so mutations are disabled."
                    .into(),
            ),
        )
    } else if !writable_non_key {
        (
            ProjectResourceMode::ReadOnly,
            Some("The resource has no non-key fields that can be mutated.".into()),
        )
    } else {
        (ProjectResourceMode::Crud, None)
    };

    Ok(ProjectResourceModel {
        id: resource.id.clone(),
        label: resource.label.clone(),
        kind: resource.kind.clone(),
        endpoint_slug: resource.endpoint_slug.clone(),
        endpoint_path: configured_resource_endpoint(config, resource),
        model_name: pascal_case(&resource.endpoint_slug),
        shape: ProjectResourceShape::Relational,
        schema_source: "catalog".into(),
        schema_source_label: "Datastore catalog".into(),
        database_name,
        schema_name,
        table_name,
        qualified_target,
        identity_format: if primary_fields.len() > 1 {
            "composite-object"
        } else if primary_fields.is_empty() {
            "none"
        } else {
            "scalar"
        }
        .into(),
        json_format: None,
        sample_status: None,
        mode,
        capability_reason,
        fields,
        primary_fields,
    })
}

pub(crate) async fn load_export_structure(
    runtime: &ManagedAppState,
    server: &DatastoreApiServerConfig,
    connection_id: &str,
    warnings: &mut Vec<String>,
) -> Vec<StructureNode> {
    let Some(environment_id) = server.environment_id.as_deref() else {
        return Vec::new();
    };
    match runtime
        .load_structure_map(StructureRequest {
            connection_id: connection_id.into(),
            environment_id: environment_id.into(),
            limit: Some(1_000),
            scope: None,
            cursor: None,
            focus_node_id: None,
            include_system_objects: Some(false),
            include_inferred_relationships: Some(true),
            max_nodes: Some(1_000),
            max_edges: Some(4_000),
            depth: Some(2),
            mode: Some("overview".into()),
        })
        .await
    {
        Ok(response) => response.nodes,
        Err(error) => {
            warnings.push(format!(
                "Structure metadata could not be loaded before export: {}",
                error.message
            ));
            Vec::new()
        }
    }
}

fn capabilities_without_connection(
    server: &DatastoreApiServerConfig,
) -> DatastoreApiServerProjectExportCapabilitiesResponse {
    let reason = "Choose a datastore before exporting this API server project.".to_string();
    DatastoreApiServerProjectExportCapabilitiesResponse {
        server_id: server.id.clone(),
        engine: String::new(),
        frameworks: ["rust", "dotnet"]
            .into_iter()
            .map(
                |framework| DatastoreApiServerProjectExportFrameworkCapability {
                    framework: framework.into(),
                    supported: false,
                    client: String::new(),
                    protocols: Vec::new(),
                    reason: Some(reason.clone()),
                    resources: Vec::new(),
                    custom_endpoints: Vec::new(),
                    warnings: Vec::new(),
                },
            )
            .collect(),
    }
}

fn unsupported_resource(
    config: &DatastoreApiServerConfig,
    resource: &DatastoreApiServerResourceConfig,
    reason: &str,
) -> ProjectResourceModel {
    ProjectResourceModel {
        id: resource.id.clone(),
        label: resource.label.clone(),
        kind: resource.kind.clone(),
        endpoint_slug: resource.endpoint_slug.clone(),
        endpoint_path: configured_resource_endpoint(config, resource),
        model_name: pascal_case(&resource.endpoint_slug),
        shape: ProjectResourceShape::Relational,
        schema_source: "unavailable".into(),
        schema_source_label: "Unavailable".into(),
        database_name: None,
        schema_name: None,
        table_name: resource.label.clone(),
        qualified_target: String::new(),
        identity_format: "unavailable".into(),
        json_format: None,
        sample_status: None,
        mode: ProjectResourceMode::Unsupported,
        capability_reason: Some(reason.into()),
        fields: Vec::new(),
        primary_fields: Vec::new(),
    }
}

pub(crate) fn matching_structure_node<'a>(
    resource: &DatastoreApiServerResourceConfig,
    nodes: &'a [StructureNode],
) -> Option<&'a StructureNode> {
    if let Some(node) = nodes.iter().find(|node| node.id == resource.node_id) {
        return Some(node);
    }
    let mut candidates = vec![
        resource.node_id.as_str(),
        resource.label.as_str(),
        resource.endpoint_slug.as_str(),
    ];
    candidates.extend(resource.path.iter().map(String::as_str));
    if let Some(scope) = resource.scope.as_deref() {
        candidates.push(scope);
    }
    let candidates = candidates
        .into_iter()
        .map(structure_match_key)
        .filter(|candidate| !candidate.is_empty())
        .collect::<Vec<_>>();
    nodes.iter().find(|node| {
        [
            node.id.as_str(),
            node.label.as_str(),
            node.object_name.as_deref().unwrap_or_default(),
            node.qualified_name.as_deref().unwrap_or_default(),
        ]
        .into_iter()
        .map(structure_match_key)
        .any(|node_key| {
            !node_key.is_empty()
                && candidates.iter().any(|candidate| {
                    node_key == *candidate
                        || node_key.ends_with(candidate)
                        || candidate.ends_with(&node_key)
                })
        })
    })
}

fn structure_match_key(value: &str) -> String {
    value
        .trim()
        .trim_matches(['"', '`', '[', ']'])
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '_' | '.') {
                character.to_ascii_lowercase()
            } else {
                '.'
            }
        })
        .collect::<String>()
        .split('.')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join(".")
}

fn physical_schema(
    resource: &DatastoreApiServerResourceConfig,
    node: &StructureNode,
) -> Option<String> {
    node.schema
        .clone()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| {
            resource
                .metadata
                .get("schema")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
        })
        .or_else(|| {
            node.qualified_name.as_deref().and_then(|qualified| {
                let parts = qualified
                    .split('.')
                    .map(|part| part.trim_matches(['"', '`', '[', ']']))
                    .filter(|part| !part.is_empty())
                    .collect::<Vec<_>>();
                (parts.len() >= 2).then(|| parts[parts.len() - 2].to_string())
            })
        })
        .or_else(|| {
            resource.scope.as_deref().and_then(|scope| {
                let qualified = scope.rsplit(':').next().unwrap_or(scope);
                let parts = qualified
                    .split('.')
                    .map(|part| part.trim_matches(['"', '`', '[', ']']))
                    .filter(|part| !part.is_empty())
                    .collect::<Vec<_>>();
                (parts.len() >= 2).then(|| parts[parts.len() - 2].to_string())
            })
        })
        .or_else(|| {
            resource
                .path
                .iter()
                .position(|part| {
                    matches!(
                        part.to_ascii_lowercase().as_str(),
                        "tables" | "views" | "materialized views"
                    )
                })
                .and_then(|index| index.checked_sub(1))
                .and_then(|index| resource.path.get(index))
                .cloned()
        })
}

fn project_field_models(fields: &[StructureField]) -> Vec<ProjectFieldModel> {
    let mut seen_rust = HashMap::new();
    let mut seen_csharp = HashMap::new();
    fields
        .iter()
        .filter(|field| !field.name.trim().is_empty())
        .map(|field| {
            let source_name = field.name.trim().to_string();
            let portable = portable_field_type(&field.data_type);
            let nullable = field.nullable.unwrap_or(true);
            let rust_name = unique_identifier(&mut seen_rust, snake_case(&source_name), "field");
            let csharp_name =
                unique_identifier(&mut seen_csharp, pascal_case(&source_name), "Field");
            ProjectFieldModel {
                source_name: source_name.clone(),
                rust_name,
                csharp_name,
                json_name: source_name,
                rust_base_type: portable.rust.into(),
                rust_type: if nullable {
                    format!("Option<{}>", portable.rust)
                } else {
                    portable.rust.into()
                },
                csharp_base_type: portable.csharp.into(),
                csharp_type: csharp_nullable_type(portable.csharp, nullable),
                data_type: field.data_type.clone(),
                nullable,
                primary: field.primary.unwrap_or(false),
                writable: portable.writable,
            }
        })
        .collect()
}

struct PortableFieldType {
    rust: &'static str,
    csharp: &'static str,
    writable: bool,
}

fn portable_field_type(data_type: &str) -> PortableFieldType {
    let normalized = data_type.trim().to_ascii_lowercase();
    let known = |rust, csharp| PortableFieldType {
        rust,
        csharp,
        writable: true,
    };
    if normalized.contains("bigint") || normalized == "int8" || normalized == "bigserial" {
        known("i64", "long")
    } else if normalized.contains("smallint") || normalized == "int2" || normalized == "smallserial"
    {
        known("i16", "short")
    } else if normalized == "integer"
        || normalized == "int"
        || normalized == "int4"
        || normalized.starts_with("serial")
    {
        known("i32", "int")
    } else if normalized.contains("bool") || normalized == "bit" {
        known("bool", "bool")
    } else if normalized.contains("double") || normalized.contains("float") || normalized == "real"
    {
        known("f64", "double")
    } else if normalized == "uuid" {
        known("uuid::Uuid", "Guid")
    } else if normalized == "date" {
        known("chrono::NaiveDate", "DateOnly")
    } else if normalized.starts_with("timestamp") || normalized == "datetime" {
        known("chrono::NaiveDateTime", "DateTime")
    } else if normalized == "time" || normalized.starts_with("time ") {
        known("chrono::NaiveTime", "TimeOnly")
    } else if normalized.contains("char")
        || normalized.contains("text")
        || normalized.contains("clob")
        || normalized == "string"
    {
        known("String", "string")
    } else {
        PortableFieldType {
            rust: "String",
            csharp: "string",
            writable: false,
        }
    }
}

fn csharp_nullable_type(base: &str, nullable: bool) -> String {
    if nullable {
        format!("{base}?")
    } else {
        base.into()
    }
}

pub(crate) fn project_custom_endpoint(
    config: &DatastoreApiServerConfig,
    endpoint: &DatastoreApiServerCustomEndpointConfig,
    adapter: &ProjectExportClientAdapter,
) -> Result<ProjectCustomEndpoint, CommandError> {
    if normalize_protocol(&config.protocol) != "rest" {
        return Err(CommandError::new(
            "api-server-export-custom-endpoint-protocol-unsupported",
            format!(
                "Custom endpoint `{}` is REST-only and cannot be exported for {}.",
                endpoint.label,
                normalize_protocol(&config.protocol)
            ),
        ));
    }
    if !endpoint.language.to_ascii_lowercase().contains("sql") {
        return Err(CommandError::new(
            "api-server-export-custom-endpoint-language-unsupported",
            format!(
                "Custom endpoint `{}` must contain a SQL read query.",
                endpoint.label
            ),
        ));
    }
    let sql = adapter.sql.ok_or_else(|| {
        CommandError::new(
            "api-server-export-custom-endpoint-language-unsupported",
            format!(
                "Custom endpoint `{}` is not supported by this datastore client.",
                endpoint.label
            ),
        )
    })?;
    let statements = crate::adapters::split_sql_batch(&endpoint.query_text, sql.batch_dialect);
    if statements.len() != 1 {
        return Err(CommandError::new(
            "api-server-export-custom-endpoint-statement-count",
            format!(
                "Custom endpoint `{}` must contain exactly one SQL statement.",
                endpoint.label
            ),
        ));
    }
    let statement = statements[0].text.trim().trim_end_matches(';').trim();
    if !security::sql_query_is_read_only(statement) {
        return Err(CommandError::new(
            "api-server-export-custom-endpoint-read-only",
            format!(
                "Custom endpoint `{}` is not a read-only SQL statement.",
                endpoint.label
            ),
        ));
    }

    let token_names = api_parameter_names(statement);
    let parameter_by_name = endpoint
        .parameters
        .iter()
        .map(|parameter| (parameter.name.as_str(), parameter))
        .collect::<HashMap<_, _>>();
    let undefined = token_names
        .iter()
        .find(|name| !parameter_by_name.contains_key(name.as_str()));
    if let Some(name) = undefined {
        return Err(CommandError::new(
            "api-server-export-custom-endpoint-parameter-undefined",
            format!(
                "Custom endpoint `{}` uses undefined API parameter `{name}`.",
                endpoint.label
            ),
        ));
    }
    let token_set = token_names
        .iter()
        .map(String::as_str)
        .collect::<HashSet<_>>();
    let mut parameters = Vec::new();
    let mut parameterized = statement.to_string();
    for (index, name) in token_names.iter().enumerate() {
        let parameter = parameter_by_name[name.as_str()];
        let (rust_type, _) =
            custom_parameter_types(&parameter.parameter_type).ok_or_else(|| {
                CommandError::new(
                    "api-server-export-custom-endpoint-parameter-unsupported",
                    format!(
                        "Custom endpoint `{}` has unsupported parameter `{name}`.",
                        endpoint.label
                    ),
                )
            })?;
        parameterized = parameterized.replace(
            &format!("{{{{api.{name}}}}}"),
            &(sql.parameter_placeholder)(index + 1),
        );
        parameters.push(ProjectEndpointParameter {
            name: name.clone(),
            parameter_type: parameter.parameter_type.clone(),
            rust_type: rust_type.into(),
            required: parameter.required,
        });
    }
    if parameterized.contains("{{") || parameterized.contains("}}") {
        return Err(CommandError::new(
            "api-server-export-custom-endpoint-template-unsupported",
            format!(
                "Custom endpoint `{}` contains a non-API or invalid template token.",
                endpoint.label
            ),
        ));
    }
    if endpoint.parameters.iter().any(|parameter| {
        token_set.contains(parameter.name.as_str())
            && custom_parameter_types(&parameter.parameter_type).is_none()
    }) {
        return Err(CommandError::new(
            "api-server-export-custom-endpoint-parameter-unsupported",
            format!(
                "Custom endpoint `{}` contains an unsupported API parameter type.",
                endpoint.label
            ),
        ));
    }
    let row_limit = endpoint.row_limit.unwrap_or(100).clamp(1, 500);
    parameterized =
        format!("SELECT * FROM ({parameterized}) AS datapad_custom_endpoint LIMIT {row_limit}");
    Ok(ProjectCustomEndpoint {
        id: endpoint.id.clone(),
        label: endpoint.label.clone(),
        method: endpoint.method.to_ascii_uppercase(),
        endpoint_path: configured_custom_endpoint_path(config, endpoint),
        function_name: snake_case(&endpoint.endpoint_slug),
        original_query: endpoint.query_text.clone(),
        parameterized_query: parameterized,
        row_limit,
        parameters,
    })
}

fn custom_parameter_types(parameter_type: &str) -> Option<(&'static str, &'static str)> {
    match parameter_type {
        "string" => Some(("String", "string")),
        "number" => Some(("f64", "double")),
        "boolean" => Some(("bool", "bool")),
        "json" => Some(("serde_json::Value", "JsonElement")),
        _ => None,
    }
}
