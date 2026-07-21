fn supported_resource_kinds(_family: &str, engine: &str) -> Vec<&'static str> {
    resource_kinds_for(engine)
}

fn current_server_config(
    state: &ApiServerRuntime,
) -> Result<DatastoreApiServerConfig, ApiRouteError> {
    state
        .config
        .lock()
        .map(|config| config.clone())
        .map_err(|_| {
            ApiRouteError::new(
                503,
                "api-server-config-unavailable",
                "API server configuration is temporarily unavailable.",
            )
        })
}

fn configured_crud_resources(config: &DatastoreApiServerConfig) -> Vec<CrudApiResource> {
    config
        .resources
        .iter()
        .filter(|resource| resource.enabled)
        .map(|resource| CrudApiResource {
            endpoint: configured_resource_endpoint(config, resource),
            kind: resource.kind.clone(),
            name: resource.label.clone(),
            node_id: resource.node_id.clone(),
            detail: resource.detail.clone().unwrap_or_default(),
            path: if resource.path.is_empty() {
                None
            } else {
                Some(resource.path.clone())
            },
            scope: resource.scope.clone(),
        })
        .collect()
}

fn configured_custom_openapi_endpoints(config: &DatastoreApiServerConfig) -> Vec<Value> {
    config
        .custom_endpoints
        .iter()
        .filter(|endpoint| endpoint.enabled)
        .map(|endpoint| {
            json!({
                "id": endpoint.id,
                "label": endpoint.label,
                "description": endpoint.description,
                "endpoint": configured_custom_endpoint_path(config, endpoint),
                "endpointSlug": endpoint.endpoint_slug,
                "method": endpoint.method,
                "sourceLibraryNodeId": endpoint.source_library_node_id,
                "sourceName": endpoint.source_name,
                "language": endpoint.language,
                "queryViewMode": endpoint.query_view_mode,
                "rowLimit": endpoint.row_limit,
                "parameters": endpoint.parameters.iter().map(|parameter| {
                    json!({
                        "name": parameter.name,
                        "type": parameter.parameter_type,
                        "required": parameter.required,
                        "defaultValue": parameter.default_value,
                        "description": parameter.description,
                        "serialization": parameter.serialization
                    })
                }).collect::<Vec<_>>()
            })
        })
        .collect()
}

fn configured_resource_endpoint(
    config: &DatastoreApiServerConfig,
    resource: &DatastoreApiServerResourceConfig,
) -> String {
    let base_path = normalize_base_path(&config.base_path);
    let slug = percent_encode_path_segment(&resource.endpoint_slug);
    if base_path.is_empty() {
        format!("/{slug}")
    } else {
        format!("{base_path}/{slug}")
    }
}

fn configured_custom_endpoint_path(
    config: &DatastoreApiServerConfig,
    endpoint: &DatastoreApiServerCustomEndpointConfig,
) -> String {
    let base_path = normalize_base_path(&config.base_path);
    let slug = percent_encode_path_segment(&endpoint.endpoint_slug);
    if base_path.is_empty() {
        format!("/{slug}")
    } else {
        format!("{base_path}/{slug}")
    }
}

fn configured_resource_for_path(
    config: &DatastoreApiServerConfig,
    path: &str,
) -> Result<Option<ParsedResourcePath>, ApiRouteError> {
    let path = normalized_log_path(path);
    let base_path = normalize_base_path(&config.base_path);
    let relative = if base_path.is_empty() {
        path.as_str()
    } else if path == base_path {
        "/"
    } else if let Some(rest) = path.strip_prefix(&format!("{base_path}/")) {
        rest
    } else {
        return Ok(None);
    };
    let trimmed = relative.trim_matches('/');
    if trimmed.is_empty() {
        return Ok(None);
    }
    let segments = trimmed.split('/').map(percent_decode).collect::<Vec<_>>();
    if segments.len() > 2 {
        return Err(ApiRouteError::new(
            400,
            "resource-path-invalid",
            "Resource routes accept a resource slug and optional identity segment.",
        ));
    }
    let slug = api_server_slug(&segments[0]);
    let Some(resource) = config
        .resources
        .iter()
        .find(|resource| resource.enabled && resource.endpoint_slug == slug)
    else {
        return Ok(None);
    };
    let identity = segments.get(1).and_then(|value| {
        (!value.is_empty())
            .then(|| serde_json::from_str(value).unwrap_or_else(|_| Value::String(value.clone())))
    });
    Ok(Some(ParsedResourcePath {
        kind: resource.kind.clone(),
        name: resource.label.clone(),
        scope: resource.scope.clone(),
        path: resource.path.clone(),
        metadata: resource.metadata.clone(),
        identity,
    }))
}

fn configured_custom_endpoint_for_path(
    config: &DatastoreApiServerConfig,
    method: &str,
    path: &str,
) -> Result<Option<DatastoreApiServerCustomEndpointConfig>, ApiRouteError> {
    let path = normalized_log_path(path);
    let base_path = normalize_base_path(&config.base_path);
    let relative = if base_path.is_empty() {
        path.as_str()
    } else if path == base_path {
        "/"
    } else if let Some(rest) = path.strip_prefix(&format!("{base_path}/")) {
        rest
    } else {
        return Ok(None);
    };
    let trimmed = relative.trim_matches('/');
    if trimmed.is_empty() {
        return Ok(None);
    }
    let segments = trimmed.split('/').map(percent_decode).collect::<Vec<_>>();
    if segments.len() != 1 {
        return Ok(None);
    }
    let slug = api_server_slug(&segments[0]);
    let Some(endpoint) = config
        .custom_endpoints
        .iter()
        .find(|endpoint| endpoint.enabled && endpoint.endpoint_slug == slug)
    else {
        return Ok(None);
    };
    if endpoint.method != method {
        return Err(ApiRouteError::new(
            405,
            "method-not-allowed",
            format!("This custom endpoint supports {}.", endpoint.method),
        ));
    }
    Ok(Some(endpoint.clone()))
}

fn resource_config_for_node(
    kind: String,
    label: String,
    node_id: String,
    detail: String,
    path: Option<Vec<String>>,
    scope: Option<String>,
) -> Option<DatastoreApiServerResourceConfig> {
    let crud_kind = crud_kind_for_node(&kind)?;
    let slug = api_server_slug(&label);
    let normalized_path = path.unwrap_or_default();
    let mut id_parts = vec![crud_kind.clone(), node_id.clone(), slug.clone()];
    if let Some(scope) = scope.as_ref().filter(|value| !value.trim().is_empty()) {
        id_parts.push(scope.clone());
    }
    id_parts.extend(normalized_path.iter().cloned());
    let id_slug = api_server_slug(&id_parts.join(" "));
    Some(DatastoreApiServerResourceConfig {
        id: format!("api-resource-{id_slug}"),
        kind: crud_kind,
        label,
        node_id,
        path: normalized_path,
        scope,
        endpoint_slug: slug,
        enabled: true,
        detail: Some(detail),
        metadata: HashMap::new(),
    })
}

fn api_server_resource_identity(resource: &DatastoreApiServerResourceConfig) -> String {
    let mut parts = vec![
        resource.kind.trim().to_string(),
        resource.node_id.trim().to_string(),
        resource.scope.as_deref().unwrap_or("").trim().to_string(),
        resource.label.trim().to_string(),
    ];
    parts.extend(resource.path.iter().map(|part| part.trim().to_string()));
    parts.join("\u{1f}").to_lowercase()
}

async fn execute_custom_endpoint(
    state: &ApiServerRuntime,
    request: &HttpRequest,
    endpoint: &DatastoreApiServerCustomEndpointConfig,
) -> Result<Value, ApiRouteError> {
    let runtime = clone_runtime(&state.app)?;
    runtime.ensure_unlocked()?;
    let connection = runtime.connection_by_id(&state.connection_id)?;
    let environment = runtime.environment_by_id(&state.environment_id)?;
    let (resolved_connection, resolved_environment, _) =
        runtime.resolve_connection_profile(&connection, &state.environment_id)?;
    let parameters = custom_endpoint_parameter_values(endpoint, request)?;
    let query_template =
        render_custom_endpoint_query(endpoint, &parameters, &resolved_environment.variables)?;

    if security::query_looks_write(&query_template) {
        return Err(ApiRouteError {
            status: 409,
            code: "custom-query-write-blocked".into(),
            message: "Custom query endpoints are read-only in this experimental version.".into(),
            details: Some(Box::new(json!({
                "endpointId": endpoint.id,
                "source": endpoint.source_name
            }))),
        });
    }

    let guardrail = security::evaluate_guardrails(
        &connection,
        &environment,
        &resolved_environment,
        &query_template,
        runtime.snapshot.preferences.safe_mode_enabled,
    );
    if guardrail.status != "allow" {
        return Err(ApiRouteError {
            status: 409,
            code: "custom-query-blocked".into(),
            message: guardrail.reasons.join(" "),
            details: Some(Box::new(json!({ "guardrail": guardrail }))),
        });
    }

    let mut execution_notices = vec![QueryExecutionNotice {
        code: "api-server-custom-query".into(),
        level: "info".into(),
        message: "Executed by a custom local API server endpoint.".into(),
    }];
    if let Some(message) = sql_dialect_hint_message(&resolved_connection, &query_template) {
        if !message.is_empty() {
            execution_notices.push(QueryExecutionNotice {
                code: "sql-syntax-hint".into(),
                level: "info".into(),
                message,
            });
        }
    }

    let execution_request = ExecutionRequest {
        execution_id: Some(generate_id("api-execution")),
        tab_id: format!("api-server-{}", endpoint.id),
        connection_id: state.connection_id.clone(),
        environment_id: state.environment_id.clone(),
        language: endpoint.language.clone(),
        query_text: query_template.clone(),
        execution_input_mode: endpoint
            .query_view_mode
            .clone()
            .or_else(|| Some("raw".into())),
        script_text: None,
        selected_text: None,
        mode: Some("full".into()),
        row_limit: endpoint.row_limit.or(Some(100)).map(|limit| limit.min(500)),
        document_efficiency_mode: None,
        confirmed_guardrail_id: None,
        builder_state: None,
        scoped_target: None,
    };
    let result = match adapters::execute(
        &resolved_connection,
        &execution_request,
        execution_notices,
    )
    .await
    {
        Ok(result) => redact_execution_result_for_environment(result, &resolved_environment),
        Err(error) => {
            return Err(
                enrich_sql_execution_error(&resolved_connection, &query_template, error).into(),
            )
        }
    };
    Ok(api_custom_query_payload(&result))
}

fn custom_endpoint_parameter_values(
    endpoint: &DatastoreApiServerCustomEndpointConfig,
    request: &HttpRequest,
) -> Result<HashMap<String, Value>, ApiRouteError> {
    let parameter_names = endpoint
        .parameters
        .iter()
        .map(|parameter| parameter.name.clone())
        .collect::<HashSet<_>>();
    let mut values = HashMap::<String, Value>::new();

    if endpoint.method == "POST" {
        if !request.body.is_empty() {
            let body = serde_json::from_slice::<Value>(&request.body).map_err(|error| {
                ApiRouteError::new(
                    400,
                    "invalid-json",
                    format!("Request body is not valid JSON: {error}"),
                )
            })?;
            let object = body.as_object().ok_or_else(|| {
                ApiRouteError::new(
                    400,
                    "custom-query-body-invalid",
                    "POST custom endpoint bodies must be JSON objects.",
                )
            })?;
            for (name, value) in object {
                if !parameter_names.contains(name) {
                    return Err(ApiRouteError::new(
                        400,
                        "custom-query-parameter-unknown",
                        format!("Parameter `{name}` is not defined for this endpoint."),
                    ));
                }
                values.insert(name.clone(), value.clone());
            }
        }
    } else {
        for (name, raw_value) in &request.query {
            if !parameter_names.contains(name) {
                return Err(ApiRouteError::new(
                    400,
                    "custom-query-parameter-unknown",
                    format!("Parameter `{name}` is not defined for this endpoint."),
                ));
            }
            let parameter = endpoint
                .parameters
                .iter()
                .find(|parameter| &parameter.name == name)
                .ok_or_else(|| {
                    ApiRouteError::new(
                        400,
                        "custom-query-parameter-unknown",
                        format!("Parameter `{name}` is not defined for this endpoint."),
                    )
                })?;
            values.insert(
                name.clone(),
                parse_custom_query_parameter_value(parameter, raw_value)?,
            );
        }
    }

    for parameter in &endpoint.parameters {
        if !values.contains_key(&parameter.name) {
            if let Some(default_value) = &parameter.default_value {
                values.insert(parameter.name.clone(), default_value.clone());
            } else if parameter.required {
                return Err(ApiRouteError::new(
                    400,
                    "custom-query-parameter-required",
                    format!("Parameter `{}` is required.", parameter.name),
                ));
            } else {
                values.insert(parameter.name.clone(), Value::Null);
            }
        }
    }

    Ok(values)
}

fn parse_custom_query_parameter_value(
    parameter: &DatastoreApiServerCustomEndpointParameterConfig,
    raw_value: &str,
) -> Result<Value, ApiRouteError> {
    match parameter.parameter_type.as_str() {
        "number" => serde_json::from_str::<Value>(raw_value)
            .ok()
            .filter(Value::is_number)
            .ok_or_else(|| {
                ApiRouteError::new(
                    400,
                    "custom-query-parameter-invalid",
                    format!("Parameter `{}` must be a number.", parameter.name),
                )
            }),
        "boolean" => match raw_value.trim().to_ascii_lowercase().as_str() {
            "true" | "1" => Ok(Value::Bool(true)),
            "false" | "0" => Ok(Value::Bool(false)),
            _ => Err(ApiRouteError::new(
                400,
                "custom-query-parameter-invalid",
                format!("Parameter `{}` must be a boolean.", parameter.name),
            )),
        },
        "json" => serde_json::from_str::<Value>(raw_value).map_err(|error| {
            ApiRouteError::new(
                400,
                "custom-query-parameter-invalid",
                format!("Parameter `{}` must be valid JSON: {error}", parameter.name),
            )
        }),
        _ => Ok(Value::String(raw_value.into())),
    }
}

fn render_custom_endpoint_query(
    endpoint: &DatastoreApiServerCustomEndpointConfig,
    values: &HashMap<String, Value>,
    environment_variables: &HashMap<String, String>,
) -> Result<String, ApiRouteError> {
    let (masked_query, tokens) = mask_api_parameter_tokens(&endpoint.query_text);
    let mut rendered = resolve_string_template(&masked_query, environment_variables)?;
    for token in tokens {
        let parameter = endpoint
            .parameters
            .iter()
            .find(|parameter| parameter.name == token.name)
            .ok_or_else(|| {
                ApiRouteError::new(
                    400,
                    "custom-query-parameter-undefined",
                    format!("Query references undefined API parameter `{}`.", token.name),
                )
            })?;
        let value = values.get(&token.name).unwrap_or(&Value::Null);
        let rendered_value = render_custom_query_parameter(parameter, value, &endpoint.language)?;
        rendered = rendered.replace(&token.placeholder, &rendered_value);
    }
    if rendered.contains("{{api.") {
        return Err(ApiRouteError::new(
            400,
            "custom-query-parameter-invalid",
            "Query contains an invalid API parameter token.",
        ));
    }
    Ok(rendered)
}

#[derive(Clone)]
struct MaskedApiParameterToken {
    name: String,
    placeholder: String,
}

fn mask_api_parameter_tokens(query_text: &str) -> (String, Vec<MaskedApiParameterToken>) {
    let mut output = String::new();
    let mut tokens = Vec::new();
    let mut offset = 0usize;
    while let Some(start) = query_text[offset..].find("{{api.") {
        let absolute_start = offset + start;
        let token_start = absolute_start + "{{api.".len();
        let Some(end) = query_text[token_start..].find("}}") else {
            break;
        };
        output.push_str(&query_text[offset..absolute_start]);
        let raw_name = &query_text[token_start..token_start + end];
        if let Some(name) = normalize_api_parameter_name(raw_name) {
            let placeholder = format!("__DATAPAD_API_PARAM_{}__", tokens.len());
            output.push_str(&placeholder);
            tokens.push(MaskedApiParameterToken { name, placeholder });
        } else {
            output.push_str(&query_text[absolute_start..token_start + end + "}}".len()]);
        }
        offset = token_start + end + "}}".len();
    }
    output.push_str(&query_text[offset..]);
    (output, tokens)
}

fn render_custom_query_parameter(
    parameter: &DatastoreApiServerCustomEndpointParameterConfig,
    value: &Value,
    language: &str,
) -> Result<String, ApiRouteError> {
    let serialization = match parameter.serialization.as_str() {
        "sql" | "json" | "raw" => parameter.serialization.as_str(),
        _ if custom_query_language_prefers_json(language) => "json",
        _ if custom_query_language_prefers_raw(language) => "raw",
        _ => "sql",
    };
    match serialization {
        "json" => serde_json::to_string(value).map_err(|error| {
            ApiRouteError::new(
                400,
                "custom-query-parameter-invalid",
                format!(
                    "Parameter `{}` could not be rendered as JSON: {error}",
                    parameter.name
                ),
            )
        }),
        "raw" => render_raw_custom_query_parameter(parameter, value),
        _ => Ok(sql_literal(value)),
    }
}

fn custom_query_language_prefers_json(language: &str) -> bool {
    matches!(
        language,
        "json" | "mongodb" | "query-dsl" | "graphql" | "aql" | "document"
    )
}

fn custom_query_language_prefers_raw(language: &str) -> bool {
    matches!(language, "redis" | "text")
}

fn render_raw_custom_query_parameter(
    parameter: &DatastoreApiServerCustomEndpointParameterConfig,
    value: &Value,
) -> Result<String, ApiRouteError> {
    let rendered = match value {
        Value::Null => String::new(),
        Value::Bool(value) => value.to_string(),
        Value::Number(value) => value.to_string(),
        Value::String(value) => value.clone(),
        _ => {
            return Err(ApiRouteError::new(
                400,
                "custom-query-parameter-invalid",
                format!(
                    "Parameter `{}` cannot be rendered raw because it is not a scalar.",
                    parameter.name
                ),
            ))
        }
    };
    if rendered.chars().any(|character| {
        character == '\n' || character == '\r' || (character.is_control() && character != '\t')
    }) {
        return Err(ApiRouteError::new(
            400,
            "custom-query-parameter-invalid",
            format!(
                "Parameter `{}` contains control characters.",
                parameter.name
            ),
        ));
    }
    Ok(rendered)
}

async fn api_resource(
    state: &ApiServerRuntime,
    request: &HttpRequest,
    resource: &ResourceRouteTarget,
    path_identity: Option<&Value>,
) -> Result<Value, ApiRouteError> {
    match request.method.as_str() {
        "GET" => execute_resource_read(state, resource, request, path_identity).await,
        "POST" | "PATCH" | "DELETE" => {
            execute_resource_mutation(state, resource, request, path_identity).await
        }
        _ => Err(ApiRouteError::new(
            405,
            "method-not-allowed",
            "This resource supports GET, POST, PATCH, and DELETE.",
        )),
    }
}

async fn execute_resource_read(
    state: &ApiServerRuntime,
    resource: &ResourceRouteTarget,
    request: &HttpRequest,
    path_identity: Option<&Value>,
) -> Result<Value, ApiRouteError> {
    let runtime = clone_runtime(&state.app)?;
    runtime.ensure_unlocked()?;
    let connection = runtime.connection_by_id(&state.connection_id)?;
    let environment = runtime.environment_by_id(&state.environment_id)?;
    let (resolved_connection, resolved_environment, _) =
        runtime.resolve_connection_profile(&connection, &state.environment_id)?;
    let row_limit = query_u32(request.query.get("limit"))
        .unwrap_or(100)
        .min(500);
    let identity = path_identity
        .cloned()
        .or_else(|| query_identity(request.query.get("identity")));
    let query_template = read_query_for(
        &connection.family,
        &connection.engine,
        resource,
        row_limit,
        identity.as_ref(),
    )?;
    let query_text = resolve_string_template(&query_template, &resolved_environment.variables)?;
    let guardrail = security::evaluate_guardrails(
        &connection,
        &environment,
        &resolved_environment,
        &query_text,
        runtime.snapshot.preferences.safe_mode_enabled,
    );
    if guardrail.status == "block" || guardrail.status == "confirm" {
        return Err(ApiRouteError {
            status: 409,
            code: "crud-read-blocked".into(),
            message: guardrail.reasons.join(" "),
            details: Some(Box::new(json!({ "guardrail": guardrail }))),
        });
    }

    let mut execution_notices = vec![QueryExecutionNotice {
        code: "api-server-read".into(),
        level: "info".into(),
        message: "Executed by the experimental local API server.".into(),
    }];
    if let Some(message) = sql_dialect_hint_message(&resolved_connection, &query_text) {
        if !message.is_empty() {
            execution_notices.push(QueryExecutionNotice {
                code: "sql-syntax-hint".into(),
                level: "info".into(),
                message,
            });
        }
    }
    let execution_request = ExecutionRequest {
        execution_id: Some(generate_id("api-execution")),
        tab_id: "api-server".into(),
        connection_id: state.connection_id.clone(),
        environment_id: state.environment_id.clone(),
        language: language_for(&connection),
        query_text: query_text.clone(),
        execution_input_mode: Some("raw".into()),
        script_text: None,
        selected_text: None,
        mode: Some("full".into()),
        row_limit: Some(row_limit),
        document_efficiency_mode: None,
        confirmed_guardrail_id: None,
        builder_state: None,
        scoped_target: None,
    };
    let result = match adapters::execute(
        &resolved_connection,
        &execution_request,
        execution_notices,
    )
    .await
    {
        Ok(result) => redact_execution_result_for_environment(result, &resolved_environment),
        Err(error) => {
            return Err(enrich_sql_execution_error(&resolved_connection, &query_text, error).into())
        }
    };
    Ok(api_read_payload(&result, identity.is_some()))
}

fn api_read_payload(result: &ExecutionResultEnvelope, single: bool) -> Value {
    for payload in &result.payloads {
        if let Some(documents) = payload.get("documents") {
            return maybe_single_resource(documents.clone(), single);
        }
    }

    for payload in &result.payloads {
        match payload.get("renderer").and_then(Value::as_str) {
            Some("searchHits") => {
                let documents = payload
                    .get("hits")
                    .and_then(Value::as_array)
                    .map(|hits| {
                        hits.iter()
                            .map(|hit| hit.get("_source").cloned().unwrap_or_else(|| hit.clone()))
                            .collect::<Vec<_>>()
                    })
                    .map(Value::Array)
                    .unwrap_or_else(|| json!([]));
                return maybe_single_resource(documents, single);
            }
            Some("keyvalue") => {
                return payload.get("entries").cloned().unwrap_or_else(|| json!({}));
            }
            Some("table") => {
                return maybe_single_resource(table_payload_to_objects(payload), single);
            }
            Some("json") => {
                if let Some(value) = payload.get("value") {
                    if let Some(items) = value.get("Items").or_else(|| value.get("items")) {
                        return maybe_single_resource(items.clone(), single);
                    }
                    if let Some(item) = value.get("Item").or_else(|| value.get("item")) {
                        return if single {
                            item.clone()
                        } else {
                            Value::Array(vec![item.clone()])
                        };
                    }
                    if let Some(keys) = value.get("keys") {
                        return maybe_single_resource(keys.clone(), single);
                    }
                    if let Some(response) = value.get("response") {
                        return response.clone();
                    }
                    return value.clone();
                }
            }
            Some("raw") => {
                return payload
                    .get("text")
                    .cloned()
                    .unwrap_or_else(|| Value::String(String::new()));
            }
            _ => {}
        }
    }

    result.payloads.first().cloned().unwrap_or(Value::Null)
}

fn api_custom_query_payload(result: &ExecutionResultEnvelope) -> Value {
    let mut values = result
        .payloads
        .iter()
        .filter_map(api_payload_data)
        .collect::<Vec<_>>();
    match values.len() {
        0 => Value::Null,
        1 => values.pop().unwrap_or(Value::Null),
        _ => Value::Array(values),
    }
}

fn api_payload_data(payload: &Value) -> Option<Value> {
    if let Some(documents) = payload.get("documents") {
        return Some(documents.clone());
    }

    match payload.get("renderer").and_then(Value::as_str) {
        Some("searchHits") => payload.get("hits").and_then(Value::as_array).map(|hits| {
            Value::Array(
                hits.iter()
                    .map(|hit| hit.get("_source").cloned().unwrap_or_else(|| hit.clone()))
                    .collect(),
            )
        }),
        Some("keyvalue") => payload.get("entries").cloned(),
        Some("table") => Some(table_payload_to_objects(payload)),
        Some("json") => payload.get("value").cloned(),
        Some("raw") => payload.get("text").cloned(),
        Some("resp") => payload.get("text").cloned(),
        _ => Some(payload.clone()),
    }
}

fn maybe_single_resource(value: Value, single: bool) -> Value {
    if !single {
        return value;
    }
    match value {
        Value::Array(items) => items.into_iter().next().unwrap_or(Value::Null),
        other => other,
    }
}

fn table_payload_to_objects(payload: &Value) -> Value {
    let columns = payload
        .get("columns")
        .and_then(Value::as_array)
        .map(|columns| {
            columns
                .iter()
                .map(|column| {
                    column
                        .as_str()
                        .map(str::to_string)
                        .unwrap_or_else(|| column.to_string())
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let rows = payload
        .get("rows")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    Value::Array(
        rows.into_iter()
            .map(|row| {
                let values = row.as_array().cloned().unwrap_or_else(|| vec![row]);
                let object = columns
                    .iter()
                    .enumerate()
                    .map(|(index, column)| {
                        (
                            column.clone(),
                            values.get(index).cloned().unwrap_or(Value::Null),
                        )
                    })
                    .collect::<serde_json::Map<_, _>>();
                Value::Object(object)
            })
            .collect(),
    )
}

async fn execute_resource_mutation(
    state: &ApiServerRuntime,
    resource: &ResourceRouteTarget,
    request: &HttpRequest,
    path_identity: Option<&Value>,
) -> Result<Value, ApiRouteError> {
    let runtime = clone_runtime(&state.app)?;
    let connection = runtime.connection_by_id(&state.connection_id)?;
    let body = if request.body.is_empty() {
        CrudMutationBody::default()
    } else {
        serde_json::from_slice::<CrudMutationBody>(&request.body).map_err(|error| {
            ApiRouteError::new(
                400,
                "invalid-json",
                format!("Request body is not a valid CRUD mutation body: {error}"),
            )
        })?
    };
    let identity = body
        .identity
        .clone()
        .or_else(|| path_identity.cloned())
        .or_else(|| query_identity(request.query.get("identity")));
    let edit_kind = edit_kind_for(
        &connection.family,
        &connection.engine,
        &resource.kind,
        &request.method,
    )?;
    let target = data_edit_target_for(&connection, resource, identity);
    let changes = mutation_changes(&request.method, &body);
    let response = runtime
        .execute_data_edit(DataEditExecutionRequest {
            connection_id: state.connection_id.clone(),
            environment_id: state.environment_id.clone(),
            edit_kind,
            target,
            changes,
            confirmation_text: body.confirmation_text,
        })
        .await?;

    if response.execution_support != "live" || !response.executed {
        return Err(ApiRouteError {
            status: 409,
            code: "crud-not-executed".into(),
            message: "The datastore adapter did not execute this CRUD mutation.".into(),
            details: Some(Box::new(json!(response))),
        });
    }

    Ok(json!({
        "connectionId": state.connection_id,
        "environmentId": state.environment_id,
        "resource": { "kind": resource.kind, "name": resource.name },
        "response": response
    }))
}

fn read_query_for(
    _family: &str,
    engine: &str,
    resource: &ResourceRouteTarget,
    limit: u32,
    identity: Option<&Value>,
) -> Result<String, ApiRouteError> {
    if let Some(query) = read_query_for_provider(engine, resource, limit, identity) {
        return query;
    }

    Err(ApiRouteError::new(
        409,
        "crud-read-unsupported",
        "This datastore/resource kind does not have a generic read route yet.",
    ))
}

fn database_for_resource(resource: &ResourceRouteTarget) -> Option<String> {
    resource
        .metadata
        .get("database")
        .or_else(|| resource.metadata.get("db"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .or_else(|| collection_database_from_scope(resource.scope.as_deref()))
        .or_else(|| {
            (resource.kind == "collection")
                .then(|| resource.path.first())
                .flatten()
                .map(String::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
        })
}

fn collection_database_from_scope(scope: Option<&str>) -> Option<String> {
    let rest = scope?.trim().strip_prefix("collection:")?;
    let (database, _) = rest.split_once(':')?;
    let database = database.trim();
    if database.is_empty() {
        None
    } else {
        Some(database.to_string())
    }
}

fn edit_kind_for(
    _family: &str,
    engine: &str,
    kind: &str,
    method: &str,
) -> Result<String, ApiRouteError> {
    let Some(edit_kind) = edit_kind_for_provider(engine, kind, method) else {
        return Err(ApiRouteError::new(
            409,
            "crud-mutation-unsupported",
            "This datastore/resource kind does not have a generic mutation route yet.",
        ));
    };
    Ok(edit_kind.into())
}

fn data_edit_target_for(
    connection: &crate::domain::models::ConnectionProfile,
    resource: &ResourceRouteTarget,
    identity: Option<Value>,
) -> DataEditTarget {
    let kind = resource.kind.as_str();
    let name = resource.name.as_str();
    let mut target = DataEditTarget {
        object_kind: kind.into(),
        path: vec![name.into()],
        database: database_for_resource(resource).or_else(|| connection.database.clone()),
        schema: None,
        table: None,
        collection: None,
        key: None,
        document_id: None,
        item_key: None,
        primary_key: None,
    };
    match kind {
        "table" => {
            target.table = Some(name.into());
            target.primary_key = identity.as_ref().and_then(value_to_map);
        }
        "collection" => {
            target.collection = Some(name.into());
            target.document_id = identity;
        }
        "key" => {
            target.key = Some(
                identity
                    .and_then(value_to_string)
                    .unwrap_or_else(|| name.into()),
            );
        }
        "item" => {
            target.table = Some(name.into());
            target.item_key = identity.as_ref().and_then(value_to_map);
        }
        "index" => {
            target.table = Some(name.into());
            target.collection = Some(name.into());
            target.document_id = identity;
        }
        _ => {}
    }
    target
}

fn mutation_changes(method: &str, body: &CrudMutationBody) -> Vec<DataEditChange> {
    if method == "DELETE" {
        return Vec::new();
    }
    if let Some(changes) = &body.changes {
        return changes.clone();
    }
    body.values
        .as_ref()
        .map(|values| {
            values
                .iter()
                .map(|(field, value)| DataEditChange {
                    field: Some(field.clone()),
                    path: Some(vec![field.clone()]),
                    value: Some(value.clone()),
                    value_type: None,
                    new_name: None,
                })
                .collect()
        })
        .unwrap_or_default()
}

fn query_identity(value: Option<&String>) -> Option<Value> {
    value.map(|value| serde_json::from_str(value).unwrap_or_else(|_| Value::String(value.clone())))
}

fn mongo_identity_filter(identity: Option<&Value>) -> Value {
    match identity {
        Some(Value::Object(object)) => Value::Object(object.clone()),
        Some(value) => json!({ "_id": value }),
        None => json!({}),
    }
}

fn sql_identity_where(identity: Option<&Value>) -> Result<String, ApiRouteError> {
    let Some(identity) = identity else {
        return Ok(String::new());
    };

    let predicates = match identity {
        Value::Object(object) => object
            .iter()
            .map(|(field, value)| format!("{} = {}", sql_identifier(field), sql_literal(value)))
            .collect::<Vec<_>>(),
        value => vec![format!("{} = {}", sql_identifier("id"), sql_literal(value))],
    };

    if predicates.is_empty() {
        return Err(ApiRouteError::new(
            400,
            "identity-invalid",
            "Identity must include at least one field.",
        ));
    }

    Ok(format!(" where {}", predicates.join(" and ")))
}

fn sql_literal(value: &Value) -> String {
    match value {
        Value::Null => "null".into(),
        Value::Bool(value) => {
            if *value {
                "true".into()
            } else {
                "false".into()
            }
        }
        Value::Number(value) => value.to_string(),
        Value::String(value) => format!("'{}'", value.replace('\'', "''")),
        value => format!("'{}'", value.to_string().replace('\'', "''")),
    }
}

fn dynamodb_key_from_identity(identity: &Value) -> Result<Value, ApiRouteError> {
    let Some(object) = identity.as_object() else {
        return Err(ApiRouteError::new(
            400,
            "identity-invalid",
            "DynamoDB item reads require an object identity.",
        ));
    };
    if object.is_empty() {
        return Err(ApiRouteError::new(
            400,
            "identity-invalid",
            "DynamoDB item identity must include at least one key field.",
        ));
    }

    Ok(Value::Object(
        object
            .iter()
            .map(|(field, value)| (field.clone(), dynamodb_attribute_value(value)))
            .collect(),
    ))
}

fn dynamodb_attribute_value(value: &Value) -> Value {
    if let Value::Object(object) = value {
        let keys = ["S", "N", "B", "BOOL", "NULL", "M", "L", "SS", "NS", "BS"];
        if object.len() == 1 && object.keys().all(|key| keys.contains(&key.as_str())) {
            return value.clone();
        }
    }

    match value {
        Value::Null => json!({ "NULL": true }),
        Value::Bool(value) => json!({ "BOOL": value }),
        Value::Number(value) => json!({ "N": value.to_string() }),
        Value::String(value) => json!({ "S": value }),
        Value::Array(values) => json!({
            "L": values.iter().map(dynamodb_attribute_value).collect::<Vec<_>>()
        }),
        Value::Object(object) => json!({
            "M": object.iter()
                .map(|(key, value)| (key.clone(), dynamodb_attribute_value(value)))
                .collect::<serde_json::Map<_, _>>()
        }),
    }
}

fn language_for(connection: &crate::domain::models::ConnectionProfile) -> String {
    language_for_provider(&connection.engine)
}

fn clone_runtime(app: &AppHandle) -> Result<ManagedAppState, ApiRouteError> {
    let state = app.state::<SharedAppState>();
    let state = state.lock().map_err(|_| {
        ApiRouteError::new(
            503,
            "workspace-state-unavailable",
            "Workspace state is temporarily unavailable.",
        )
    })?;
    Ok(ManagedAppState {
        app: state.app.clone(),
        snapshot: state.snapshot.clone(),
    })
}

