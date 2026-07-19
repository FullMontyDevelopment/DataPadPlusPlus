async fn openapi_document(
    state: &ApiServerRuntime,
    config: &DatastoreApiServerConfig,
) -> Result<Value, ApiRouteError> {
    let runtime = clone_runtime(&state.app)?;
    let connection = runtime.connection_by_id(&state.connection_id)?;
    let resource_kinds = supported_resource_kinds(&connection.family, &connection.engine);
    let mut warnings = local_warnings();
    let resources = configured_crud_resources(config);
    let custom_endpoints = configured_custom_openapi_endpoints(config);
    if resources.is_empty() && custom_endpoints.is_empty() {
        warnings
            .push("No CRUD resources or custom endpoints are configured for this server.".into());
    }
    let mut paths = serde_json::Map::new();
    for resource in &resources {
        paths.insert(
            resource.endpoint.clone(),
            resource_collection_path_item(resource),
        );
        paths.insert(
            format!("{}/{{identity}}", resource.endpoint),
            resource_identity_path_item(resource),
        );
    }
    for endpoint in &custom_endpoints {
        paths.insert(
            endpoint
                .get("endpoint")
                .and_then(Value::as_str)
                .unwrap_or("/")
                .to_string(),
            custom_endpoint_path_item(endpoint),
        );
    }

    Ok(json!({
        "openapi": "3.1.0",
        "info": {
            "title": "DataPad++ Experimental Datastore API",
            "version": "0.1.0",
            "description": "Local-only CRUD API for the selected DataPad++ datastore and environment."
        },
        "servers": [
            {
                "url": format!("http://{API_HOST}:{}", state.port),
                "description": "Loopback listener"
            }
        ],
        "x-datapad": {
            "connection": {
                "id": connection.id,
                "name": connection.name,
                "engine": connection.engine,
                "family": connection.family,
                "readOnly": connection.read_only
            },
            "environmentId": state.environment_id,
            "supportedResourceKinds": resource_kinds,
            "resourceEndpointStyle": "concrete-crud",
            "resources": resources,
            "customEndpoints": custom_endpoints,
            "warnings": warnings
        },
        "paths": paths,
        "components": {
            "schemas": {
                "CrudMutationBody": {
                    "type": "object",
                    "properties": {
                        "identity": {
                            "description": "Scalar or object identity for update/delete/read operations."
                        },
                        "values": {
                            "type": "object",
                            "additionalProperties": true
                        },
                        "changes": {
                            "type": "array",
                            "items": { "type": "object", "additionalProperties": true }
                        },
                        "confirmationText": { "type": "string" }
                    }
                },
                "ErrorResponse": {
                    "type": "object",
                    "properties": {
                        "error": {
                            "type": "object",
                            "properties": {
                                "code": { "type": "string" },
                                "message": { "type": "string" },
                                "details": {}
                            }
                        }
                    }
                }
            }
        }
    }))
}

fn resource_collection_path_item(resource: &CrudApiResource) -> Value {
    let resource_extension = json!({
        "kind": resource.kind,
        "name": resource.name,
        "endpoint": resource.endpoint,
        "nodeId": resource.node_id,
        "detail": resource.detail,
        "path": resource.path,
        "scope": resource.scope
    });
    json!({
        "get": {
            "tags": [resource.name.clone()],
            "operationId": resource_operation_id("search", resource),
            "summary": format!("Search {}", resource.name),
            "description": format!(
                "Search or list data from the {} resource named {}.",
                resource.kind, resource.name
            ),
            "parameters": search_parameters(),
            "x-datapad-resource": resource_extension.clone(),
            "responses": {
                "200": crud_search_response(resource),
                "409": error_response("Unsupported resource capability")
            }
        },
        "post": {
            "tags": [resource.name.clone()],
            "operationId": resource_operation_id("create", resource),
            "summary": format!("Create {}", resource.name),
            "description": format!(
                "Create one object in the {} resource named {}.",
                resource.kind, resource.name
            ),
            "requestBody": crud_mutation_request_body("create"),
            "x-datapad-resource": resource_extension.clone(),
            "responses": {
                "200": crud_mutation_response("Created object"),
                "409": error_response("Mutation not executed or unsupported")
            }
        }
    })
}

fn resource_identity_path_item(resource: &CrudApiResource) -> Value {
    let resource_extension = json!({
        "kind": resource.kind,
        "name": resource.name,
        "endpoint": resource.endpoint,
        "nodeId": resource.node_id,
        "detail": resource.detail,
        "path": resource.path,
        "scope": resource.scope
    });
    json!({
        "get": {
            "tags": [resource.name.clone()],
            "operationId": resource_operation_id("get", resource),
            "summary": format!("Get {}", resource.name),
            "description": format!(
                "Get one object from the {} resource named {} by identity.",
                resource.kind, resource.name
            ),
            "parameters": identity_path_parameters(),
            "x-datapad-resource": resource_extension.clone(),
            "responses": {
                "200": crud_entity_response("Object returned from the resource"),
                "409": error_response("Unsupported resource capability")
            }
        },
        "patch": {
            "tags": [resource.name.clone()],
            "operationId": resource_operation_id("update", resource),
            "summary": format!("Update {}", resource.name),
            "description": format!(
                "Update one object in the {} resource named {} by identity.",
                resource.kind, resource.name
            ),
            "parameters": identity_path_parameters(),
            "requestBody": crud_mutation_request_body("update"),
            "x-datapad-resource": resource_extension.clone(),
            "responses": {
                "200": crud_mutation_response("Updated object"),
                "409": error_response("Mutation not executed or unsupported")
            }
        },
        "delete": {
            "tags": [resource.name.clone()],
            "operationId": resource_operation_id("delete", resource),
            "summary": format!("Delete {}", resource.name),
            "description": format!(
                "Delete one object from the {} resource named {} by identity.",
                resource.kind, resource.name
            ),
            "parameters": identity_path_parameters(),
            "x-datapad-resource": resource_extension,
            "responses": {
                "200": crud_mutation_response("Deleted object"),
                "409": error_response("Mutation not executed or unsupported")
            }
        }
    })
}

fn custom_endpoint_path_item(endpoint: &Value) -> Value {
    let method = endpoint
        .get("method")
        .and_then(Value::as_str)
        .unwrap_or("GET")
        .to_ascii_lowercase();
    let mut operation = serde_json::Map::new();
    operation.insert(
        "tags".into(),
        json!([endpoint
            .get("label")
            .and_then(Value::as_str)
            .unwrap_or("Custom Query")]),
    );
    operation.insert(
        "operationId".into(),
        json!(format!(
            "runCustom{}",
            operation_name_fragment(
                endpoint
                    .get("label")
                    .and_then(Value::as_str)
                    .unwrap_or("Query")
            )
        )),
    );
    operation.insert(
        "summary".into(),
        json!(format!(
            "Run {}",
            endpoint
                .get("label")
                .and_then(Value::as_str)
                .unwrap_or("custom query")
        )),
    );
    operation.insert(
        "description".into(),
        json!(endpoint
            .get("description")
            .and_then(Value::as_str)
            .unwrap_or("Run a saved DataPad++ query through this custom endpoint.")),
    );
    operation.insert("x-datapad-customEndpoint".into(), endpoint.clone());
    operation.insert(
        "responses".into(),
        json!({
            "200": {
                "description": "Query result data",
                "content": {
                    "application/json": {
                        "schema": {},
                        "examples": {
                            "data": {
                                "summary": "Result data",
                                "value": [{ "id": 1, "name": "Example" }]
                            }
                        }
                    }
                }
            },
            "400": error_response("Invalid or missing API parameter"),
            "409": error_response("Custom query blocked by API server guardrails")
        }),
    );
    if method == "post" {
        operation.insert("requestBody".into(), custom_endpoint_request_body(endpoint));
    } else {
        operation.insert(
            "parameters".into(),
            custom_endpoint_query_parameters(endpoint),
        );
    }

    let mut path_item = serde_json::Map::new();
    path_item.insert(method, Value::Object(operation));
    Value::Object(path_item)
}

fn custom_endpoint_query_parameters(endpoint: &Value) -> Value {
    Value::Array(
        endpoint
            .get("parameters")
            .and_then(Value::as_array)
            .map(|parameters| {
                parameters
                    .iter()
                    .filter_map(|parameter| {
                        let name = parameter.get("name").and_then(Value::as_str)?;
                        Some(json!({
                            "name": name,
                            "in": "query",
                            "required": parameter.get("required").and_then(Value::as_bool).unwrap_or(false),
                            "description": parameter.get("description").and_then(Value::as_str).unwrap_or("Custom query parameter."),
                            "schema": custom_endpoint_parameter_schema(parameter),
                            "example": custom_endpoint_parameter_example(parameter)
                        }))
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default(),
    )
}

fn custom_endpoint_request_body(endpoint: &Value) -> Value {
    let properties = endpoint
        .get("parameters")
        .and_then(Value::as_array)
        .map(|parameters| {
            parameters
                .iter()
                .filter_map(|parameter| {
                    let name = parameter.get("name").and_then(Value::as_str)?;
                    Some((
                        name.to_string(),
                        custom_endpoint_parameter_schema(parameter),
                    ))
                })
                .collect::<serde_json::Map<_, _>>()
        })
        .unwrap_or_default();
    let required = endpoint
        .get("parameters")
        .and_then(Value::as_array)
        .map(|parameters| {
            parameters
                .iter()
                .filter(|parameter| {
                    parameter
                        .get("required")
                        .and_then(Value::as_bool)
                        .unwrap_or(false)
                })
                .filter_map(|parameter| parameter.get("name").and_then(Value::as_str))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    json!({
        "required": true,
        "content": {
            "application/json": {
                "schema": {
                    "type": "object",
                    "properties": properties,
                    "required": required
                },
                "example": custom_endpoint_body_example(endpoint)
            }
        }
    })
}

fn custom_endpoint_parameter_schema(parameter: &Value) -> Value {
    match parameter.get("type").and_then(Value::as_str) {
        Some("number") => json!({ "type": "number" }),
        Some("boolean") => json!({ "type": "boolean" }),
        Some("json") => json!({}),
        _ => json!({ "type": "string" }),
    }
}

fn custom_endpoint_parameter_example(parameter: &Value) -> Value {
    if let Some(default_value) = parameter.get("defaultValue") {
        return default_value.clone();
    }
    match parameter.get("type").and_then(Value::as_str) {
        Some("number") => json!(123),
        Some("boolean") => json!(true),
        Some("json") => json!({ "value": "example" }),
        _ => json!("example"),
    }
}

fn custom_endpoint_body_example(endpoint: &Value) -> Value {
    let mut object = serde_json::Map::new();
    if let Some(parameters) = endpoint.get("parameters").and_then(Value::as_array) {
        for parameter in parameters {
            if let Some(name) = parameter.get("name").and_then(Value::as_str) {
                object.insert(name.into(), custom_endpoint_parameter_example(parameter));
            }
        }
    }
    Value::Object(object)
}

fn resource_operation_id(action: &str, resource: &CrudApiResource) -> String {
    format!(
        "{}{}{}",
        action,
        operation_name_fragment(&resource.kind),
        operation_name_fragment(&resource.name)
    )
}

fn operation_name_fragment(value: &str) -> String {
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

fn search_parameters() -> Vec<Value> {
    vec![json!({
        "name": "limit",
        "in": "query",
        "description": "Maximum number of objects to return.",
        "schema": { "type": "integer", "minimum": 1, "maximum": 500 },
        "example": 50
    })]
}

fn identity_path_parameters() -> Vec<Value> {
    vec![json!({
        "name": "identity",
        "in": "path",
        "required": true,
        "schema": { "type": "string" },
        "description": "Scalar identity, or a URL-encoded JSON identity object for composite keys.",
        "example": "1"
    })]
}

fn crud_mutation_request_body(action: &str) -> Value {
    let example = match action {
        "update" => json!({
            "identity": { "id": 1 },
            "changes": [{ "field": "name", "value": "Example" }]
        }),
        _ => json!({
            "values": { "name": "Example" }
        }),
    };
    let mut examples = serde_json::Map::new();
    examples.insert(
        action.into(),
        json!({
            "summary": format!("{} example", operation_name_fragment(action)),
            "value": example
        }),
    );
    json!({
        "required": true,
        "description": "JSON mutation payload. Safe mode, read-only profiles, and confirmation guardrails still apply.",
        "content": {
            "application/json": {
                "schema": { "$ref": "#/components/schemas/CrudMutationBody" },
                "examples": examples
            }
        }
    })
}

fn crud_search_response(resource: &CrudApiResource) -> Value {
    json!({
        "description": format!("List of {} documents or rows.", resource.name),
        "content": {
            "application/json": {
                "schema": {
                    "type": "array",
                    "items": { "type": "object", "additionalProperties": true }
                },
                "examples": {
                    "documents": {
                        "summary": "Document list",
                        "value": [{ "id": 1, "name": "Example" }]
                    }
                }
            }
        }
    })
}

fn crud_entity_response(description: &str) -> Value {
    json!({
        "description": description,
        "content": {
            "application/json": {
                "schema": { "type": "object", "additionalProperties": true },
                "examples": {
                    "document": {
                        "summary": "Document",
                        "value": { "id": 1, "name": "Example" }
                    }
                }
            }
        }
    })
}

fn crud_mutation_response(description: &str) -> Value {
    json!({
        "description": description,
        "content": {
            "application/json": {
                "schema": { "type": "object", "additionalProperties": true },
                "examples": {
                    "result": {
                        "summary": "Mutation result",
                        "value": { "ok": true, "id": 1 }
                    }
                }
            }
        }
    })
}

fn error_response(description: &str) -> Value {
    json!({
        "description": description,
        "content": {
            "application/json": {
                "schema": { "$ref": "#/components/schemas/ErrorResponse" },
                "examples": {
                    "error": {
                        "value": {
                            "error": {
                                "code": "crud-mutation-unsupported",
                                "message": description,
                                "details": null
                            }
                        }
                    }
                }
            }
        }
    })
}

