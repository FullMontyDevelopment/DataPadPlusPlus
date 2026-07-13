use serde_json::{json, Value};

use super::super::super::*;
use super::connection::{janusgraph_gremlin_body, janusgraph_run_gremlin};
use super::query_request::{janusgraph_query_request, JanusGraphQueryRequest};
use super::query_results::{normalize_janusgraph_result, NormalizedJanusGraphResult};
use super::JanusGraphAdapter;

pub(super) async fn execute_janusgraph_query(
    adapter: &JanusGraphAdapter,
    connection: &ResolvedConnectionProfile,
    request: &ExecutionRequest,
    notices: Vec<QueryExecutionNotice>,
) -> Result<ExecutionResultEnvelope, CommandError> {
    let started = Instant::now();
    let query_text = selected_query(request).trim();
    if query_text.is_empty() {
        return Err(CommandError::new(
            "janusgraph-query-missing",
            "No Gremlin query was provided.",
        ));
    }

    let row_limit = bounded_page_size(
        request
            .row_limit
            .or(Some(adapter.execution_capabilities().default_row_limit)),
    );
    let query_request = janusgraph_query_request(query_text, execute_mode(request))?;
    let value = janusgraph_run_gremlin(connection, &query_request.gremlin).await?;
    let normalized = normalize_janusgraph_result(&value, row_limit);
    let mut notices = notices;
    if normalized.truncated {
        notices.push(QueryExecutionNotice {
            code: "janusgraph-result-truncated".into(),
            level: "warning".into(),
            message: format!(
                "JanusGraph returned more than {row_limit} row(s) or graph item bounds; displayed results were bounded before rendering."
            ),
        });
    }
    let row_count = normalized.rows.len() as u32;
    let graph = normalized.graph_payload.clone();
    let profile = janusgraph_profile_payload(&query_request, &normalized, row_limit);
    let mut payloads = Vec::new();
    if let Some(graph) = graph {
        let metadata = graph.metadata("janusgraph", "gremlin");
        let (nodes, edges) = graph.into_parts();
        payloads.push(payload_graph_with_metadata(nodes, edges, metadata));
    }
    payloads.extend([
        payload_table(vec!["value".into()], normalized.rows),
        profile,
        payload_json(value.clone()),
        payload_raw(janusgraph_gremlin_body(connection, &query_request.gremlin)?),
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
        summary: format!("JanusGraph Gremlin returned {row_count} result item(s)."),
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

fn janusgraph_profile_payload(
    query_request: &JanusGraphQueryRequest,
    normalized: &NormalizedJanusGraphResult,
    row_limit: u32,
) -> Value {
    payload_profile(
        "JanusGraph Gremlin profile",
        json!([
            {
                "stage": "request",
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
                    "Add limit(), label filters, edge labels, or narrower traversals before rendering large graph results."
                } else {
                    "Result is within the selected display bound."
                }
            }
        ]),
    )
}
