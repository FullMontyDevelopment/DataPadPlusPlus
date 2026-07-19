fn validate_local_host(host: &str) -> Result<(), CommandError> {
    if host == API_HOST {
        Ok(())
    } else {
        Err(CommandError::new(
            "api-server-host-invalid",
            "The experimental API server only supports 127.0.0.1.",
        ))
    }
}

fn validate_port(port: u16) -> Result<(), CommandError> {
    if port >= 1024 {
        Ok(())
    } else {
        Err(CommandError::new(
            "api-server-port-invalid",
            "Choose an API server port from 1024 through 65535.",
        ))
    }
}

fn next_available_port(servers: &[DatastoreApiServerConfig]) -> u16 {
    let used_ports = servers
        .iter()
        .map(|server| server.port)
        .collect::<std::collections::HashSet<_>>();
    let mut port = 17640_u16;
    while port < u16::MAX {
        if !used_ports.contains(&port) && std::net::TcpListener::bind((API_HOST, port)).is_ok() {
            return port;
        }
        port = port.saturating_add(1);
    }
    17640
}

fn normalize_protocol(value: &str) -> String {
    match value {
        "graphql" | "grpc" => value.into(),
        _ => "rest".into(),
    }
}

fn normalize_base_path(value: &str) -> String {
    let trimmed = value.trim().trim_matches('/');
    if trimmed.is_empty() {
        String::new()
    } else {
        format!("/{trimmed}")
    }
}

fn normalize_resource_configs(
    resources: Vec<DatastoreApiServerResourceConfig>,
) -> Vec<DatastoreApiServerResourceConfig> {
    let mut seen = HashMap::<String, usize>::new();
    resources
        .into_iter()
        .enumerate()
        .map(|(index, mut resource)| {
            if resource.id.trim().is_empty() {
                resource.id = format!("api-resource-{}", index + 1);
            }
            resource.kind = match resource.kind.as_str() {
                "collection" | "key" | "item" | "index" => resource.kind.clone(),
                _ => "table".into(),
            };
            if resource.label.trim().is_empty() {
                resource.label = resource.node_id.clone();
            }
            if resource.node_id.trim().is_empty() {
                resource.node_id = resource.label.clone();
            }
            let slug = if resource.endpoint_slug.trim().is_empty() {
                api_server_slug(&resource.label)
            } else {
                api_server_slug(&resource.endpoint_slug)
            };
            let count = seen.entry(slug.clone()).or_insert(0);
            *count += 1;
            resource.endpoint_slug = if *count > 1 {
                format!("{slug}-{count}")
            } else {
                slug
            };
            resource.enabled = resource.enabled || !resource.id.is_empty();
            resource
        })
        .collect()
}

fn normalize_custom_endpoint_configs(
    endpoints: Vec<DatastoreApiServerCustomEndpointConfig>,
    resources: &[DatastoreApiServerResourceConfig],
) -> Vec<DatastoreApiServerCustomEndpointConfig> {
    let mut seen = resources
        .iter()
        .map(|resource| (resource.endpoint_slug.clone(), 1usize))
        .collect::<HashMap<_, _>>();
    endpoints
        .into_iter()
        .enumerate()
        .map(|(index, mut endpoint)| {
            if endpoint.id.trim().is_empty() {
                endpoint.id = format!("api-endpoint-{}", index + 1);
            }
            endpoint.label = endpoint.label.trim().to_string();
            if endpoint.label.is_empty() {
                endpoint.label = endpoint.source_name.trim().to_string();
            }
            if endpoint.label.is_empty() {
                endpoint.label = format!("Custom Endpoint {}", index + 1);
            }
            endpoint.source_name = endpoint.source_name.trim().to_string();
            if endpoint.source_name.is_empty() {
                endpoint.source_name = endpoint.label.clone();
            }
            endpoint.description = endpoint
                .description
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty());
            endpoint.method = match endpoint.method.trim().to_ascii_uppercase().as_str() {
                "POST" => "POST".into(),
                _ => "GET".into(),
            };
            endpoint.language = endpoint.language.trim().to_string();
            if endpoint.language.is_empty() {
                endpoint.language = "sql".into();
            }
            endpoint.query_view_mode = match endpoint.query_view_mode.as_deref() {
                Some("builder" | "raw" | "script") => endpoint.query_view_mode.clone(),
                _ => Some("raw".into()),
            };
            endpoint.row_limit = endpoint.row_limit.map(|limit| limit.clamp(1, 500));
            let slug = if endpoint.endpoint_slug.trim().is_empty() {
                api_server_slug(&endpoint.label)
            } else {
                api_server_slug(&endpoint.endpoint_slug)
            };
            let count = seen.entry(slug.clone()).or_insert(0);
            *count += 1;
            endpoint.endpoint_slug = if *count > 1 {
                format!("{slug}-{count}")
            } else {
                slug
            };
            endpoint.parameters =
                normalize_custom_endpoint_parameters(endpoint.parameters, &endpoint.query_text);
            endpoint
        })
        .collect()
}

fn normalize_custom_endpoint_parameters(
    parameters: Vec<DatastoreApiServerCustomEndpointParameterConfig>,
    query_text: &str,
) -> Vec<DatastoreApiServerCustomEndpointParameterConfig> {
    let mut seen = HashSet::<String>::new();
    let mut normalized = Vec::new();
    for (index, mut parameter) in parameters.into_iter().enumerate() {
        let name = normalize_api_parameter_name(&parameter.name)
            .unwrap_or_else(|| format!("param{}", index + 1));
        if !seen.insert(name.clone()) {
            continue;
        }
        parameter.name = name;
        parameter.parameter_type = match parameter.parameter_type.as_str() {
            "number" | "boolean" | "json" => parameter.parameter_type,
            _ => "string".into(),
        };
        parameter.serialization = match parameter.serialization.as_str() {
            "sql" | "json" | "raw" => parameter.serialization,
            _ => "auto".into(),
        };
        parameter.description = parameter
            .description
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        normalized.push(parameter);
    }

    for name in api_parameter_names(query_text) {
        if seen.insert(name.clone()) {
            normalized.push(DatastoreApiServerCustomEndpointParameterConfig {
                name,
                parameter_type: "string".into(),
                required: true,
                default_value: None,
                description: None,
                serialization: "auto".into(),
            });
        }
    }

    normalized
}

fn normalize_export_framework(value: &str) -> Result<String, CommandError> {
    match value.trim().to_ascii_lowercase().as_str() {
        "rust" => Ok("rust".into()),
        "dotnet" | ".net" | "net" => Ok("dotnet".into()),
        _ => Err(CommandError::new(
            "api-server-export-framework-unsupported",
            "Choose Rust or .NET for the exported API server project.",
        )),
    }
}

fn normalize_export_project_name(value: &str) -> Result<String, CommandError> {
    let normalized = pascal_case(value);
    if normalized.is_empty() {
        Err(CommandError::new(
            "api-server-export-project-name-required",
            "Enter a project name before exporting this API server project.",
        ))
    } else {
        Ok(normalized)
    }
}

fn normalize_export_namespace(value: Option<&str>, project_name: &str) -> String {
    let raw = value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(project_name);
    let normalized = raw
        .split('.')
        .map(pascal_case)
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join(".");
    if normalized.is_empty() {
        project_name.into()
    } else {
        normalized
    }
}

fn normalize_export_package_name(value: Option<&str>, project_name: &str) -> String {
    let raw = value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(project_name);
    let name = raw
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '_' || ch == '-' {
                ch.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect::<String>()
        .split('-')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    if name.is_empty() {
        "datapad-api-server".into()
    } else {
        name
    }
}

fn export_provider_for_connection(
    family: &str,
    engine: &str,
) -> Result<ExportProvider, CommandError> {
    if family == "sql"
        || matches!(
            engine,
            "sqlite" | "postgresql" | "cockroachdb" | "mysql" | "mariadb" | "sqlserver"
        )
    {
        return Ok(ExportProvider::Sql);
    }
    if matches!(engine, "mongodb" | "cosmosdb") {
        return Ok(ExportProvider::MongoDb);
    }
    if engine == "litedb" {
        return Ok(ExportProvider::LiteDb);
    }
    if matches!(engine, "elasticsearch" | "opensearch") || family == "search" {
        return Ok(ExportProvider::Search);
    }
    if engine == "dynamodb" {
        return Ok(ExportProvider::DynamoDb);
    }
    if matches!(engine, "redis" | "valkey") {
        return Ok(ExportProvider::Redis);
    }
    Err(CommandError::new(
        "api-server-export-provider-unsupported",
        format!("Project export does not yet support typed models for {engine} ({family})."),
    ))
}

fn export_provider_env_var(provider: ExportProvider) -> &'static str {
    match provider {
        ExportProvider::DynamoDb => "AWS_REGION",
        ExportProvider::LiteDb => "LITEDB_PATH",
        ExportProvider::MongoDb => "MONGODB_URI",
        ExportProvider::Redis => "REDIS_URL",
        ExportProvider::Search => "SEARCH_ENDPOINT",
        ExportProvider::Sql => "DATABASE_URL",
    }
}

fn provider_label(provider: ExportProvider) -> &'static str {
    match provider {
        ExportProvider::DynamoDb => "DynamoDB",
        ExportProvider::LiteDb => "LiteDB",
        ExportProvider::MongoDb => "MongoDB",
        ExportProvider::Redis => "Redis/Valkey",
        ExportProvider::Search => "Elasticsearch/OpenSearch",
        ExportProvider::Sql => "SQL",
    }
}

fn validate_project_export_resources(
    provider: ExportProvider,
    resources: &[DatastoreApiServerResourceConfig],
) -> Result<(), CommandError> {
    for resource in resources {
        let supported = match provider {
            ExportProvider::DynamoDb => matches!(resource.kind.as_str(), "item" | "table"),
            ExportProvider::LiteDb => resource.kind == "collection",
            ExportProvider::MongoDb => resource.kind == "collection",
            ExportProvider::Redis => resource.kind == "key",
            ExportProvider::Search => resource.kind == "index",
            ExportProvider::Sql => resource.kind == "table",
        };
        if !supported {
            return Err(CommandError::new(
                "api-server-export-resource-unsupported",
                format!(
                    "Resource `{}` cannot be exported as a typed {} project yet.",
                    resource.label,
                    provider_label(provider)
                ),
            ));
        }
    }
    Ok(())
}

fn validate_project_export_custom_endpoints(
    provider: ExportProvider,
    protocol: &str,
    endpoints: &[DatastoreApiServerCustomEndpointConfig],
) -> Result<(), CommandError> {
    if endpoints.is_empty() {
        return Ok(());
    }
    if protocol != "rest" {
        return Err(CommandError::new(
            "api-server-export-custom-endpoint-protocol-unsupported",
            "Custom query endpoints can only be exported for REST/OpenAPI projects in this version.",
        ));
    }
    for endpoint in endpoints {
        if !custom_endpoint_language_supported(provider, &endpoint.language) {
            return Err(CommandError::new(
                "api-server-export-custom-endpoint-language-unsupported",
                format!(
                    "Custom endpoint `{}` uses `{}`, which is not supported by this export provider.",
                    endpoint.label, endpoint.language
                ),
            ));
        }
        for parameter in &endpoint.parameters {
            if !matches!(
                parameter.parameter_type.as_str(),
                "string" | "number" | "boolean" | "json"
            ) {
                return Err(CommandError::new(
                    "api-server-export-custom-endpoint-parameter-unsupported",
                    format!(
                        "Custom endpoint `{}` has unsupported parameter `{}`.",
                        endpoint.label, parameter.name
                    ),
                ));
            }
        }
    }
    Ok(())
}

fn custom_endpoint_language_supported(provider: ExportProvider, language: &str) -> bool {
    match provider {
        ExportProvider::DynamoDb => matches!(language, "dynamodb" | "json"),
        ExportProvider::LiteDb => {
            language.contains("sql") || matches!(language, "litedb" | "json" | "query")
        }
        ExportProvider::MongoDb => matches!(language, "mongodb" | "json" | "query-dsl"),
        ExportProvider::Redis => matches!(language, "redis" | "text" | "raw"),
        ExportProvider::Search => matches!(
            language,
            "query-dsl" | "json" | "elasticsearch" | "opensearch"
        ),
        ExportProvider::Sql => {
            language.contains("sql")
                || matches!(
                    language,
                    "sql" | "cql" | "snowflake-sql" | "google-sql" | "clickhouse-sql"
                )
        }
    }
}

