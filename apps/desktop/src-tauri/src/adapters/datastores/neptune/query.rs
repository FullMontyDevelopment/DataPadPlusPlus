use serde_json::{json, Value};

use super::super::super::*;
use super::connection::{neptune_post_form, neptune_post_json, parse_neptune_json};
use super::query_request::{neptune_query_request, NeptuneQueryRequest};
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
    let graph = normalized.graph.clone();
    let profile = neptune_profile_payload(&query_request, &normalized, row_limit);
    let mut payloads = Vec::new();
    if let Some((nodes, edges)) = graph {
        payloads.push(payload_graph(nodes, edges));
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
