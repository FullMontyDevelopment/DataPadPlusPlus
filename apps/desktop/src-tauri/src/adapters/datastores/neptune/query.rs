use std::time::SystemTime;

use aws_credential_types::provider::ProvideCredentials;
use aws_sigv4::{
    http_request::{sign, SignableBody, SignableRequest, SigningParams, SigningSettings},
    sign::v4,
};
use aws_smithy_types::{Document, Number};
use reqwest::{header, Method};
use serde_json::{json, Value};

use super::super::super::*;
use super::connection::{
    neptune_connect_mode, neptune_iam_runtime, neptune_post_form, neptune_post_json,
    parse_neptune_json, NeptuneIamRuntime,
};
use super::query_request::{
    neptune_query_request, neptune_request_is_read_only, NeptuneQueryRequest,
};
use super::query_results::{
    normalize_gremlin_result, normalize_json_rows, normalize_sparql_result, NormalizedNeptuneResult,
};
use super::NeptuneAdapter;

pub(super) async fn execute_neptune_query(
    adapter: &NeptuneAdapter,
    connection: &ResolvedConnectionProfile,
    request: &ExecutionRequest,
    notices: Vec<QueryExecutionNotice>,
) -> Result<ExecutionResultEnvelope, CommandError> {
    let started = Instant::now();
    let query_text = selected_query(request).trim();
    if query_text.is_empty() {
        return Err(CommandError::new(
            "neptune-query-missing",
            "No Neptune graph query was provided.",
        ));
    }

    let row_limit = bounded_page_size(
        request
            .row_limit
            .or(Some(adapter.execution_capabilities().default_row_limit)),
    );
    let query_request =
        neptune_query_request(&request.language, query_text, execute_mode(request))?;
    if connection.read_only && !neptune_request_is_read_only(&query_request) {
        return Err(CommandError::new(
            "neptune-read-only-violation",
            "This Amazon Neptune connection is read-only and cannot execute a graph mutation.",
        ));
    }
    let value = execute_by_language(connection, &query_request).await?;
    let normalized = normalize_by_language(&query_request, &value, row_limit);
    let mut notices = notices;
    if normalized.truncated {
        notices.push(QueryExecutionNotice {
            code: "neptune-result-truncated".into(),
            level: "warning".into(),
            message: format!(
                "Amazon Neptune returned more than {row_limit} row(s) or graph item bounds; displayed results were bounded before rendering."
            ),
        });
    }
    let row_count = normalized.rows.len() as u32;
    let graph = normalized.graph_payload.clone();
    let profile = neptune_profile_payload(&query_request, &normalized, row_limit);
    let mut payloads = Vec::new();
    if let Some(graph) = graph {
        let metadata = graph.metadata("neptune", query_request.language);
        let (nodes, edges) = graph.into_parts();
        payloads.push(payload_graph_with_metadata(nodes, edges, metadata));
    }
    payloads.extend([
        payload_table(normalized.columns, normalized.rows),
        profile,
        payload_json(value.clone()),
        payload_raw(query_request.body.clone()),
    ]);
    let explain_payload = if matches!(query_request.mode, "explain" | "profile") {
        Some(value.clone())
    } else {
        None
    };
    let (default_renderer, renderer_modes_owned) = renderer_modes_for_payloads(&payloads);
    let renderer_modes = renderer_modes_owned
        .iter()
        .map(String::as_str)
        .collect::<Vec<&str>>();

    Ok(build_result(ResultEnvelopeInput {
        engine: &connection.engine,
        summary: format!(
            "Amazon Neptune {} query returned {row_count} displayed row(s).",
            query_request.language
        ),
        default_renderer: &default_renderer,
        renderer_modes,
        payloads,
        notices,
        duration_ms: duration_ms(started),
        row_limit: Some(row_limit),
        truncated: normalized.truncated,
        explain_payload,
    }))
}

async fn execute_by_language(
    connection: &ResolvedConnectionProfile,
    query_request: &NeptuneQueryRequest,
) -> Result<Value, CommandError> {
    if neptune_connect_mode(connection) == "neptune-iam" {
        return execute_neptune_iam(connection, query_request).await;
    }
    if query_request.language == "gremlin" {
        let response =
            neptune_post_json(connection, query_request.path, &query_request.body).await?;
        return parse_neptune_json(&response.body);
    }
    let response = neptune_post_form(
        connection,
        query_request.path,
        &query_request.body,
        query_request.accept.unwrap_or("application/json"),
    )
    .await?;
    parse_neptune_json(&response.body)
}

pub(super) async fn execute_neptune_metadata(
    connection: &ResolvedConnectionProfile,
    language: &str,
    query: &str,
) -> Result<Value, CommandError> {
    let request = neptune_query_request(language, query, "run")?;
    execute_by_language(connection, &request).await
}

async fn execute_neptune_iam(
    connection: &ResolvedConnectionProfile,
    query_request: &NeptuneQueryRequest,
) -> Result<Value, CommandError> {
    let runtime = neptune_iam_runtime(connection).await?;
    match query_request.language {
        "gremlin" => {
            let query = query_request
                .gremlin
                .as_deref()
                .unwrap_or(&query_request.query);
            let output = runtime
                .client
                .execute_gremlin_query()
                .gremlin_query(query)
                .serializer("application/vnd.gremlin-v3.0+json")
                .send()
                .await
                .map_err(|_| neptune_iam_query_error("Gremlin"))?;
            Ok(json!({
                "requestId": output.request_id,
                "meta": output.meta_value.map(document_to_json),
                "result": {
                    "data": output.result.map(document_to_json).unwrap_or_else(|| json!([]))
                }
            }))
        }
        "opencypher" => {
            let output = runtime
                .client
                .execute_open_cypher_query()
                .open_cypher_query(&query_request.query)
                .send()
                .await
                .map_err(|_| neptune_iam_query_error("openCypher"))?;
            let value = document_to_json(output.results);
            if value.get("results").is_some() {
                Ok(value)
            } else {
                Ok(json!({ "results": value }))
            }
        }
        "sparql" => execute_signed_sparql(connection, &runtime, query_request).await,
        _ => Err(CommandError::new(
            "neptune-language-unsupported",
            "Amazon Neptune supports Gremlin, openCypher, and SPARQL queries.",
        )),
    }
}

async fn execute_signed_sparql(
    connection: &ResolvedConnectionProfile,
    runtime: &NeptuneIamRuntime,
    query_request: &NeptuneQueryRequest,
) -> Result<Value, CommandError> {
    let credentials_provider = runtime.sdk_config.credentials_provider().ok_or_else(|| {
        CommandError::new(
            "neptune-iam-credentials-missing",
            "Amazon Neptune IAM could not resolve AWS credentials.",
        )
    })?;
    let credentials = credentials_provider
        .provide_credentials()
        .await
        .map_err(|_| {
            CommandError::new(
                "neptune-iam-credentials-failed",
                "Amazon Neptune IAM could not load AWS credentials from the selected provider.",
            )
        })?;
    let identity = credentials.into();
    let signing_settings = SigningSettings::default();
    let signing_params: SigningParams<'_> = v4::SigningParams::builder()
        .identity(&identity)
        .region(&runtime.region)
        .name("neptune-db")
        .time(SystemTime::now())
        .settings(signing_settings)
        .build()
        .map_err(|_| {
            CommandError::new(
                "neptune-iam-signing-failed",
                "Amazon Neptune SPARQL request could not be signed.",
            )
        })?
        .into();
    let url = format!("{}/sparql", runtime.endpoint.trim_end_matches('/'));
    let content_type = "application/x-www-form-urlencoded";
    let accept = query_request
        .accept
        .unwrap_or("application/sparql-results+json, application/json");
    let signable = SignableRequest::new(
        "POST",
        &url,
        [("content-type", content_type), ("accept", accept)].into_iter(),
        SignableBody::Bytes(query_request.body.as_bytes()),
    )
    .map_err(|_| {
        CommandError::new(
            "neptune-iam-signing-failed",
            "Amazon Neptune SPARQL request could not be prepared for signing.",
        )
    })?;
    let (instructions, _) = sign(signable, &signing_params)
        .map_err(|_| {
            CommandError::new(
                "neptune-iam-signing-failed",
                "Amazon Neptune SPARQL request could not be signed.",
            )
        })?
        .into_parts();
    let client = graph_http_client(connection)?;
    let mut request = graph_http_request(&client, Method::POST, &url, connection)
        .header(header::CONTENT_TYPE, content_type)
        .header(header::ACCEPT, accept)
        .body(query_request.body.clone());
    for (name, value) in instructions.headers() {
        request = request.header(name, value);
    }
    let response = request.send().await.map_err(|_| {
        CommandError::new(
            "neptune-iam-query-failed",
            "Amazon Neptune IAM SPARQL request failed. Verify network access and IAM data permissions.",
        )
    })?;
    let response = graph_http_response(
        response,
        "neptune-iam-query-failed",
        "Amazon Neptune IAM SPARQL request failed.",
    )
    .await?;
    parse_neptune_json(&response.body)
}

fn neptune_iam_query_error(language: &str) -> CommandError {
    CommandError::new(
        "neptune-iam-query-failed",
        format!(
            "Amazon Neptune IAM {language} query failed. Verify network access, AWS credentials, and neptune-db query permissions."
        ),
    )
}

fn document_to_json(document: Document) -> Value {
    match document {
        Document::Object(values) => Value::Object(
            values
                .into_iter()
                .map(|(key, value)| (key, document_to_json(value)))
                .collect(),
        ),
        Document::Array(values) => Value::Array(values.into_iter().map(document_to_json).collect()),
        Document::Number(Number::PosInt(value)) => json!(value),
        Document::Number(Number::NegInt(value)) => json!(value),
        Document::Number(Number::Float(value)) => json!(value),
        Document::String(value) => Value::String(value),
        Document::Bool(value) => Value::Bool(value),
        Document::Null => Value::Null,
    }
}

fn normalize_by_language(
    query_request: &NeptuneQueryRequest,
    value: &Value,
    row_limit: u32,
) -> NormalizedNeptuneResult {
    match query_request.language {
        "sparql" => normalize_sparql_result(value, row_limit),
        "opencypher" => normalize_json_rows(value, row_limit),
        _ => normalize_gremlin_result(value, row_limit),
    }
}

fn neptune_profile_payload(
    query_request: &NeptuneQueryRequest,
    normalized: &NormalizedNeptuneResult,
    row_limit: u32,
) -> Value {
    payload_profile(
        "Amazon Neptune query profile",
        json!([
            {
                "stage": "request",
                "language": query_request.language,
                "mode": query_request.mode,
                "rowLimit": row_limit
            },
            {
                "stage": "result",
                "rows": normalized.total_rows,
                "displayedRows": normalized.rows.len(),
                "nodes": normalized.node_count,
                "edges": normalized.edge_count,
                "truncated": normalized.truncated
            },
            {
                "stage": "risk",
                "cardinality": if normalized.truncated { "bounded" } else { "within-limit" },
                "recommendation": if normalized.truncated {
                    "Add LIMIT/limit(), label filters, relationship predicates, or narrower graph patterns before rendering large graph results."
                } else {
                    "Result is within the selected display bound."
                }
            }
        ]),
    )
}
