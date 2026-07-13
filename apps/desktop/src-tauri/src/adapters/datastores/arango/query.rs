use serde_json::{json, Value};

use super::super::super::*;
use super::connection::arango_post_json;
use super::query_request::{arango_query_request, ArangoQueryRequest};
use super::query_results::{
    normalize_arango_result, validate_arango_response, NormalizedArangoResult,
};
use super::ArangoDbAdapter;

pub(super) async fn execute_arango_query(
    adapter: &ArangoDbAdapter,
    connection: &ResolvedConnectionProfile,
    request: &ExecutionRequest,
    notices: Vec<QueryExecutionNotice>,
) -> Result<ExecutionResultEnvelope, CommandError> {
    let started = Instant::now();
    let query_text = selected_query(request).trim();
    if query_text.is_empty() {
        return Err(CommandError::new(
            "arango-query-missing",
            "No AQL query was provided.",
        ));
    }

    let row_limit = bounded_page_size(
        request
            .row_limit
            .or(Some(adapter.execution_capabilities().default_row_limit)),
    );
    let query_request = arango_query_request(query_text, execute_mode(request), row_limit)?;
    let (payloads, row_count, explain_payload, truncated) = if query_request.mode == "explain" {
        let response =
            arango_post_json(connection, "/_api/explain", &query_request.explain_body).await?;
        let value = parse_arango_json(&response.body)?;
        validate_arango_response(&value)?;
        (
            vec![
                payload_plan("json", value.clone(), "ArangoDB AQL explain plan returned."),
                payload_json(value.clone()),
                payload_raw(query_request.explain_body.clone()),
            ],
            1,
            Some(value),
            false,
        )
    } else {
        let response =
            arango_post_json(connection, "/_api/cursor", &query_request.cursor_body).await?;
        let value = parse_arango_json(&response.body)?;
        validate_arango_response(&value)?;
        let result = value.get("result").cloned().unwrap_or_else(|| json!([]));
        let normalized = normalize_arango_result(&result, row_limit);
        let truncated = normalized.truncated
            || value
                .get("hasMore")
                .and_then(Value::as_bool)
                .unwrap_or(false);
        let row_count = normalized.rows.len() as u32;
        let profile = arango_profile_payload(&query_request, &normalized, row_limit, truncated);
        let mut payloads = vec![
            payload_document(normalized.documents),
            payload_table(vec!["document".into()], normalized.rows),
            profile,
            payload_json(value),
            payload_raw(query_request.cursor_body.clone()),
        ];
        if let Some(graph) = normalized.graph_payload {
            let metadata = graph.metadata("arango", "aql");
            let (nodes, edges) = graph.into_parts();
            payloads.insert(0, payload_graph_with_metadata(nodes, edges, metadata));
        }
        (payloads, row_count, None, truncated)
    };
    let mut notices = notices;
    if truncated {
        notices.push(QueryExecutionNotice {
            code: "arango-result-truncated".into(),
            level: "warning".into(),
            message: format!(
                "ArangoDB returned more than {row_limit} row(s) or graph item bounds; displayed results were bounded before rendering."
            ),
        });
    }

    let (default_renderer, renderer_modes_owned) = renderer_modes_for_payloads(&payloads);
    let renderer_modes = renderer_modes_owned
        .iter()
        .map(String::as_str)
        .collect::<Vec<&str>>();

    Ok(build_result(ResultEnvelopeInput {
        engine: &connection.engine,
        summary: format!("ArangoDB AQL returned {row_count} row(s)."),
        default_renderer: &default_renderer,
        renderer_modes,
        payloads,
        notices,
        duration_ms: duration_ms(started),
        row_limit: Some(row_limit),
        truncated,
        explain_payload,
    }))
}

fn parse_arango_json(body: &str) -> Result<Value, CommandError> {
    serde_json::from_str(body).map_err(|error| {
        CommandError::new(
            "arango-json-invalid",
            format!("ArangoDB returned invalid JSON: {error}"),
        )
    })
}

fn arango_profile_payload(
    query_request: &ArangoQueryRequest,
    normalized: &NormalizedArangoResult,
    row_limit: u32,
    truncated: bool,
) -> Value {
    payload_profile(
        "ArangoDB AQL profile",
        json!([
            {
                "stage": "request",
                "mode": query_request.mode,
                "fetchLimit": query_request.fetch_limit,
                "rowLimit": row_limit
            },
            {
                "stage": "result",
                "rows": normalized.total_rows,
                "displayedRows": normalized.rows.len(),
                "nodes": normalized.node_count,
                "edges": normalized.edge_count,
                "truncated": truncated
            },
            {
                "stage": "risk",
                "cardinality": if truncated { "bounded" } else { "within-limit" },
                "recommendation": if truncated {
                    "Add LIMIT, collection filters, or narrower graph traversals before rendering large AQL graph results."
                } else {
                    "Result is within the selected display bound."
                }
            }
        ]),
    )
}
