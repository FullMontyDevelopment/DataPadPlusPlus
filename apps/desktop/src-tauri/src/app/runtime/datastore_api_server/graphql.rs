async fn route_graphql_request(
    request: HttpRequest,
    state: Arc<ApiServerRuntime>,
    config: &DatastoreApiServerConfig,
) -> Result<Value, ApiRouteError> {
    let path = normalized_log_path(&request.path);
    if request.method == "GET" && path == "/graphql" {
        return Ok(json!({
            "schema": graphql_schema(config),
            "resources": graphql_resources(config)
        }));
    }
    if request.method != "POST" || path != "/graphql" {
        return Err(ApiRouteError::new(
            404,
            "not-found",
            "GraphQL servers expose POST /graphql and GET /graphql.",
        ));
    }
    let body = serde_json::from_slice::<Value>(&request.body).map_err(|error| {
        ApiRouteError::new(
            400,
            "invalid-json",
            format!("GraphQL request body is invalid: {error}"),
        )
    })?;
    let query = body.get("query").and_then(Value::as_str).ok_or_else(|| {
        ApiRouteError::new(400, "graphql-query-required", "GraphQL query is required.")
    })?;
    let variables = body
        .get("variables")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    for resource in config.resources.iter().filter(|resource| resource.enabled) {
        let names = graphql_names(resource);
        if graphql_mentions(query, &names.create) {
            let response = execute_graphql_mutation(
                Arc::clone(&state),
                &request,
                resource,
                "POST",
                &variables,
            )
            .await?;
            return Ok(graphql_data_response(&names.create, response));
        }
        if graphql_mentions(query, &names.update) {
            let response = execute_graphql_mutation(
                Arc::clone(&state),
                &request,
                resource,
                "PATCH",
                &variables,
            )
            .await?;
            return Ok(graphql_data_response(&names.update, response));
        }
        if graphql_mentions(query, &names.delete) {
            let response = execute_graphql_mutation(
                Arc::clone(&state),
                &request,
                resource,
                "DELETE",
                &variables,
            )
            .await?;
            return Ok(graphql_data_response(&names.delete, response));
        }
        if graphql_mentions(query, &names.single) {
            let response =
                execute_graphql_read(Arc::clone(&state), &request, resource, &variables, true)
                    .await?;
            return Ok(graphql_data_response(&names.single, response));
        }
        if graphql_mentions(query, &names.list) {
            let response =
                execute_graphql_read(Arc::clone(&state), &request, resource, &variables, false)
                    .await?;
            return Ok(graphql_data_response(&names.list, response));
        }
    }
    Err(ApiRouteError::new(
        400,
        "graphql-field-unsupported",
        "The GraphQL query did not reference a configured CRUD resource field.",
    ))
}

fn graphql_data_response(field: &str, value: Value) -> Value {
    let mut data = serde_json::Map::new();
    data.insert(field.into(), value);
    json!({ "data": Value::Object(data) })
}

async fn execute_graphql_read(
    state: Arc<ApiServerRuntime>,
    request: &HttpRequest,
    resource: &DatastoreApiServerResourceConfig,
    variables: &serde_json::Map<String, Value>,
    single: bool,
) -> Result<Value, ApiRouteError> {
    let mut query = request.query.clone();
    if let Some(limit) = variables.get("limit").and_then(Value::as_u64) {
        query.insert("limit".into(), limit.to_string());
    }
    let identity = variables
        .get("identity")
        .cloned()
        .or_else(|| variables.get("id").cloned());
    if let Some(identity) = identity.as_ref() {
        query.insert("identity".into(), identity.to_string());
    } else if single {
        return Err(ApiRouteError::new(
            400,
            "graphql-identity-required",
            "Single-resource GraphQL reads require an identity variable.",
        ));
    }
    let synthetic = HttpRequest {
        method: "GET".into(),
        path: format!("/{}", resource.endpoint_slug),
        query,
        headers: request.headers.clone(),
        body: Vec::new(),
    };
    let target = ResourceRouteTarget::from_resource(resource);
    execute_resource_read(&state, &target, &synthetic, identity.as_ref()).await
}

async fn execute_graphql_mutation(
    state: Arc<ApiServerRuntime>,
    request: &HttpRequest,
    resource: &DatastoreApiServerResourceConfig,
    method: &str,
    variables: &serde_json::Map<String, Value>,
) -> Result<Value, ApiRouteError> {
    let body = json!({
        "identity": variables.get("identity").or_else(|| variables.get("id")),
        "values": variables.get("values").or_else(|| variables.get("input")),
        "changes": variables.get("changes"),
        "confirmationText": variables.get("confirmationText")
    });
    let synthetic = HttpRequest {
        method: method.into(),
        path: format!("/{}", resource.endpoint_slug),
        query: request.query.clone(),
        headers: request.headers.clone(),
        body: serde_json::to_vec(&body).unwrap_or_default(),
    };
    let identity = variables.get("identity").or_else(|| variables.get("id"));
    let target = ResourceRouteTarget::from_resource(resource);
    execute_resource_mutation(&state, &target, &synthetic, identity).await
}

fn graphql_schema(config: &DatastoreApiServerConfig) -> String {
    let mut query_fields = Vec::new();
    let mut mutation_fields = Vec::new();
    for resource in config.resources.iter().filter(|resource| resource.enabled) {
        let names = graphql_names(resource);
        query_fields.push(format!("  {}(limit: Int = 100): JSON", names.list));
        query_fields.push(format!("  {}(identity: JSON, id: ID): JSON", names.single));
        mutation_fields.push(format!(
            "  {}(input: JSON, values: JSON, confirmationText: String): JSON",
            names.create
        ));
        mutation_fields.push(format!("  {}(identity: JSON, id: ID, changes: JSON, values: JSON, confirmationText: String): JSON", names.update));
        mutation_fields.push(format!(
            "  {}(identity: JSON, id: ID, confirmationText: String): JSON",
            names.delete
        ));
    }
    format!(
        "scalar JSON\n\ntype Query {{\n{}\n}}\n\ntype Mutation {{\n{}\n}}\n",
        query_fields.join("\n"),
        mutation_fields.join("\n")
    )
}

fn graphql_resources(config: &DatastoreApiServerConfig) -> Vec<Value> {
    config
        .resources
        .iter()
        .filter(|resource| resource.enabled)
        .map(|resource| {
            let names = graphql_names(resource);
            json!({
                "resourceId": resource.id,
                "label": resource.label,
                "kind": resource.kind,
                "fields": {
                    "search": names.list,
                    "get": names.single,
                    "create": names.create,
                    "update": names.update,
                    "delete": names.delete
                }
            })
        })
        .collect()
}

struct GraphqlNames {
    list: String,
    single: String,
    create: String,
    update: String,
    delete: String,
}

fn graphql_names(resource: &DatastoreApiServerResourceConfig) -> GraphqlNames {
    let list = graphql_identifier(&resource.endpoint_slug);
    let single = singular_graphql_name(&list);
    let pascal = pascal_fragment(&list);
    GraphqlNames {
        list,
        single,
        create: format!("create{pascal}"),
        update: format!("update{pascal}"),
        delete: format!("delete{pascal}"),
    }
}

fn graphql_mentions(query: &str, field: &str) -> bool {
    query.contains(&format!("{field}("))
        || query.contains(&format!("{field} "))
        || query.contains(&format!("{field}\n"))
        || query.contains(&format!("{field}\r"))
        || query.contains(&format!("{field}{{"))
}

fn graphql_identifier(value: &str) -> String {
    let mut output = String::new();
    let mut capitalize = false;
    for character in value.chars() {
        if character.is_ascii_alphanumeric() {
            if output.is_empty() && character.is_ascii_digit() {
                output.push('_');
            }
            output.push(if capitalize {
                character.to_ascii_uppercase()
            } else {
                character.to_ascii_lowercase()
            });
            capitalize = false;
        } else {
            capitalize = true;
        }
    }
    if output.is_empty() {
        "resource".into()
    } else {
        output
    }
}

fn singular_graphql_name(value: &str) -> String {
    if value.ends_with("ies") && value.len() > 3 {
        format!("{}y", &value[..value.len() - 3])
    } else if value.ends_with('s') && value.len() > 1 {
        value[..value.len() - 1].into()
    } else {
        format!("{value}Item")
    }
}

fn pascal_fragment(value: &str) -> String {
    let mut output = String::new();
    let mut capitalize = true;
    for character in value.chars() {
        if character.is_ascii_alphanumeric() {
            if capitalize {
                output.push(character.to_ascii_uppercase());
                capitalize = false;
            } else {
                output.push(character);
            }
        } else {
            capitalize = true;
        }
    }
    if output.is_empty() {
        "Resource".into()
    } else {
        output
    }
}

