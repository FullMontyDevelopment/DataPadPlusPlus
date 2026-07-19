async fn route_grpc_document_request(
    request: HttpRequest,
    config: &DatastoreApiServerConfig,
) -> Result<Value, ApiRouteError> {
    let path = normalized_log_path(&request.path);
    if request.method == "GET" && matches!(path.as_str(), "/proto" | "/datapad.proto") {
        return Ok(json!({
            "proto": grpc_proto_document(config),
            "resources": grpc_resources(config),
            "reflection": "generated-proto"
        }));
    }
    Err(ApiRouteError::new(
        501,
        "grpc-runtime-unavailable",
        "This build exposes generated gRPC proto metadata, but binary gRPC serving is not available yet.",
    ))
}

fn grpc_proto_document(config: &DatastoreApiServerConfig) -> String {
    let mut services = Vec::new();
    for resource in config.resources.iter().filter(|resource| resource.enabled) {
        let service = format!(
            r#"service {name}Service {{
  rpc Search (SearchRequest) returns (JsonResponse);
  rpc Get (IdentityRequest) returns (JsonResponse);
  rpc Create (MutationRequest) returns (JsonResponse);
  rpc Update (MutationRequest) returns (JsonResponse);
  rpc Delete (IdentityRequest) returns (JsonResponse);
}}"#,
            name = pascal_fragment(&graphql_identifier(&resource.endpoint_slug)),
        );
        services.push(service);
    }
    format!(
        r#"syntax = "proto3";
package datapad.api.v1;

message SearchRequest {{
  uint32 limit = 1;
}}

message IdentityRequest {{
  string identity_json = 1;
  string confirmation_text = 2;
}}

message MutationRequest {{
  string identity_json = 1;
  string values_json = 2;
  string changes_json = 3;
  string confirmation_text = 4;
}}

message JsonResponse {{
  string json = 1;
}}

{}
"#,
        services.join("\n\n")
    )
}

fn grpc_resources(config: &DatastoreApiServerConfig) -> Vec<Value> {
    config
        .resources
        .iter()
        .filter(|resource| resource.enabled)
        .map(|resource| {
            json!({
                "resourceId": resource.id,
                "label": resource.label,
                "kind": resource.kind,
                "service": format!("{}Service", pascal_fragment(&graphql_identifier(&resource.endpoint_slug)))
            })
        })
        .collect()
}

