use serde_json::json;

use super::super::super::*;
use super::connection::{neo4j_run_cypher, neo4j_statement_body};
use super::query_request::{is_read_only_cypher, neo4j_query_request, Neo4jQueryRequest};
use super::query_results::{normalize_neo4j_result, NormalizedNeo4jResult};
use super::Neo4jAdapter;

pub(super) async fn execute_neo4j_query(
    adapter: &Neo4jAdapter,
    connection: &ResolvedConnectionProfile,
    request: &ExecutionRequest,
    notices: Vec<QueryExecutionNotice>,
) -> Result<ExecutionResultEnvelope, CommandError> {
    let started = Instant::now();
    let query_text = selected_query(request).trim();
    if query_text.is_empty() {
        return Err(CommandError::new(
            "neo4j-query-missing",
            "No Cypher query was provided.",
        ));
    }
    let row_limit = bounded_page_size(
        request
            .row_limit
            .or(Some(adapter.execution_capabilities().default_row_limit)),
    );
    let query_request = neo4j_query_request(query_text, execute_mode(request))?;
    if connection.read_only && query_request.mode != "explain" && !is_read_only_cypher(query_text) {
        return Err(CommandError::new(
            "neo4j-read-only-violation",
            "This Neo4j connection is read-only and cannot execute a mutating Cypher statement.",
        ));
    }
    let value = neo4j_run_cypher(connection, &query_request.statement).await?;
    let normalized = normalize_neo4j_result(&value, row_limit);
    let mut notices = notices;
    if normalized.truncated {
        notices.push(QueryExecutionNotice {
            code: "neo4j-result-truncated".into(),
            level: "warning".into(),
            message: format!(
                "Neo4j returned more than {row_limit} row(s) or graph item bounds; displayed results were bounded before rendering."
            ),
        });
    }
    let row_count = normalized.rows.len() as u32;
    let graph = normalized.graph_payload.clone();
    let profile = neo4j_profile_payload(&query_request, &normalized, row_limit);
    let mut payloads = Vec::new();
    if let Some(graph) = graph {
        let metadata = graph.metadata("neo4j", "cypher");
        let (nodes, edges) = graph.into_parts();
        payloads.push(payload_graph_with_metadata(nodes, edges, metadata));
    }
    payloads.extend([
        payload_table(normalized.columns, normalized.rows),
        profile,
        payload_json(value.clone()),
        payload_raw(neo4j_statement_body(&query_request.statement)),
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
            "Neo4j {} Cypher returned {row_count} displayed row(s).",
            query_request.mode
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

fn neo4j_profile_payload(
    query_request: &Neo4jQueryRequest,
    normalized: &NormalizedNeo4jResult,
    row_limit: u32,
) -> Value {
    payload_profile(
        "Neo4j Cypher profile",
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
                "relationships": normalized.relationship_count,
                "truncated": normalized.truncated
            },
            {
                "stage": "stats",
                "stats": normalized.stats
            },
            {
                "stage": "risk",
                "cardinality": if normalized.truncated { "bounded" } else { "within-limit" },
                "recommendation": if normalized.truncated {
                    "Add LIMIT, label filters, relationship type filters, or narrower graph patterns before rendering large graphs."
                } else {
                    "Result is within the selected display bound."
                }
            }
        ]),
    )
}
