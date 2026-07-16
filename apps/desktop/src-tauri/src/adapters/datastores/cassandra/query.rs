use serde_json::{json, Value};

use super::super::super::*;
use super::connection::{cassandra_contact_point, cassandra_keyspace};
use super::native::{connect_cassandra, execute_cassandra_statement};
use super::CassandraAdapter;

pub(super) async fn execute_cassandra_query(
    adapter: &CassandraAdapter,
    connection: &ResolvedConnectionProfile,
    request: &ExecutionRequest,
    mut notices: Vec<QueryExecutionNotice>,
) -> Result<ExecutionResultEnvelope, CommandError> {
    let started = Instant::now();
    let statement = selected_query(request).trim();
    if statement.is_empty() {
        return Err(CommandError::new(
            "cassandra-query-missing",
            "No CQL query was provided.",
        ));
    }
    if !is_read_only_cql(statement) {
        return Err(CommandError::new(
            "cassandra-write-preview-only",
            "Cassandra schema/data mutations are operation-plan preview only in this adapter phase.",
        ));
    }
    let batch_statements = split_sql_batch(statement, SqlBatchDialect::Standard);
    if batch_statements
        .iter()
        .any(|statement| !is_read_only_cql(&statement.text))
    {
        return Err(CommandError::new(
            "cassandra-write-preview-only",
            "Cassandra schema/data mutations are operation-plan preview only; the batch was blocked before execution.",
        ));
    }

    let row_limit = bounded_page_size(
        request
            .row_limit
            .or(Some(adapter.execution_capabilities().default_row_limit)),
    );
    let tracing_enabled = matches!(execute_mode(request), "profile" | "trace");
    let session = connect_cassandra(connection).await?;

    if batch_statements.len() > 1 {
        let mut sections = Vec::new();
        let mut total_rows = 0usize;
        let mut truncated = false;

        for statement in &batch_statements {
            let statement_started = Instant::now();
            let execution_statement = cassandra_statement_for_execution(&statement.text, row_limit);
            let response = execute_cassandra_statement(
                &session,
                connection,
                &execution_statement,
                row_limit,
                tracing_enabled,
            )
            .await?;
            let normalized = normalize_cassandra_response_bounded(&response, row_limit);
            let row_count = normalized.rows.len();
            let section_truncated = normalized.truncated;
            total_rows += row_count;
            truncated |= section_truncated;
            sections.push(batch_section(BatchSectionPayload {
                id: format!("cassandra-statement-{}", statement.index),
                label: format!("Result {}", statement.index),
                statement: Some(statement.text.clone()),
                status: "success",
                duration_ms: Some(duration_ms(statement_started)),
                row_count: Some(row_count),
                default_renderer: "table".into(),
                renderer_modes: vec!["table".into(), "json".into()],
                payloads: vec![
                    payload_table(normalized.columns, normalized.rows),
                    payload_json(bounded_cassandra_response(
                        response,
                        row_limit,
                        section_truncated,
                    )),
                ],
                notices: Vec::new(),
            }));
        }

        return Ok(build_result(ResultEnvelopeInput {
            engine: &connection.engine,
            summary: format!("Cassandra CQL batch normalized {total_rows} row(s)."),
            default_renderer: "batch",
            renderer_modes: vec!["batch", "json", "raw"],
            payloads: vec![
                payload_batch(
                    sections,
                    format!("Cassandra CQL batch normalized {total_rows} row(s)."),
                ),
                payload_json(json!({
                    "engine": connection.engine,
                    "rowCount": total_rows,
                    "rowLimit": row_limit,
                    "statementCount": batch_statements.len(),
                })),
                payload_raw(statement.to_string()),
            ],
            notices,
            duration_ms: duration_ms(started),
            row_limit: Some(row_limit),
            truncated,
            explain_payload: None,
        }));
    }

    let execution_statement = cassandra_statement_for_execution(statement, row_limit);
    if cql_needs_partition_key_warning(&execution_statement) {
        notices.push(QueryExecutionNotice {
            code: "cassandra-partition-key-warning".into(),
            level: "warning".into(),
            message: "Cassandra SELECT queries should include a complete partition key to avoid broad partition scans.".into(),
        });
    }
    if execution_statement
        .to_ascii_lowercase()
        .contains("allow filtering")
    {
        notices.push(QueryExecutionNotice {
            code: "cassandra-allow-filtering-warning".into(),
            level: "warning".into(),
            message: "ALLOW FILTERING can scan large partitions and should be used deliberately."
                .into(),
        });
    }

    let request_payload =
        cassandra_request_payload(connection, &execution_statement, row_limit, tracing_enabled);
    let response = execute_cassandra_statement(
        &session,
        connection,
        &execution_statement,
        row_limit,
        tracing_enabled,
    )
    .await?;
    let normalized = normalize_cassandra_response_bounded(&response, row_limit);
    let columns = normalized.columns;
    let rows = normalized.rows;
    let truncated = normalized.truncated;
    let row_count = rows.len() as u32;
    let profile_payload = payload_profile(
        "Cassandra native CQL execution and partition-key guardrails.",
        json!({
            "protocol": "CQL native binary protocol v4",
            "contactPoint": cassandra_contact_point(connection),
            "keyspace": cassandra_keyspace(connection),
            "statement": execution_statement,
            "pageSize": row_limit,
            "partitionKeyRequired": cql_needs_partition_key_warning(&execution_statement),
            "allowFilteringWarning": execution_statement.to_ascii_lowercase().contains("allow filtering"),
            "tracing": tracing_enabled
        }),
    );
    let payloads = vec![
        payload_table(columns, rows),
        payload_json(bounded_cassandra_response(response, row_limit, truncated)),
        payload_plan(
            "json",
            request_payload.clone(),
            "Executed native CQL request with consistency and partition-key guardrails.",
        ),
        profile_payload,
        payload_metrics(json!([
            {
                "name": "cassandra.query.partition_key_guard",
                "value": if cql_needs_partition_key_warning(&execution_statement) { 1 } else { 0 },
                "unit": "flag",
                "labels": { "keyspace": cassandra_keyspace(connection) }
            },
            {
                "name": "cassandra.query.allow_filtering_guard",
                "value": if execution_statement.to_ascii_lowercase().contains("allow filtering") { 1 } else { 0 },
                "unit": "flag",
                "labels": { "keyspace": cassandra_keyspace(connection) }
            }
        ])),
        payload_raw(serde_json::to_string_pretty(&request_payload).unwrap_or_default()),
    ];
    let (default_renderer, renderer_modes_owned) = renderer_modes_for_payloads(&payloads);
    let renderer_modes = renderer_modes_owned
        .iter()
        .map(String::as_str)
        .collect::<Vec<&str>>();

    Ok(build_result(ResultEnvelopeInput {
        engine: &connection.engine,
        summary: if truncated {
            format!("Cassandra returned the first {row_count} row(s).")
        } else {
            format!("Cassandra returned {row_count} row(s).")
        },
        default_renderer: &default_renderer,
        renderer_modes,
        payloads,
        notices,
        duration_ms: duration_ms(started),
        row_limit: Some(row_limit),
        truncated,
        explain_payload: None,
    }))
}

pub(crate) fn cassandra_request_payload(
    connection: &ResolvedConnectionProfile,
    statement: &str,
    row_limit: u32,
    tracing_enabled: bool,
) -> Value {
    json!({
        "protocol": "cql-native-v4",
        "contactPoint": cassandra_contact_point(connection),
        "keyspace": cassandra_keyspace(connection),
        "statement": strip_sql_semicolon(statement),
        "consistency": cassandra_consistency_label(connection),
        "pageSize": row_limit,
        "tracing": tracing_enabled,
        "guardrails": {
            "mutationPreviewOnly": true,
            "partitionKeyFirst": true,
            "allowFilteringWarning": statement.to_lowercase().contains("allow filtering")
        }
    })
}

pub(crate) fn cassandra_statement_for_execution(statement: &str, row_limit: u32) -> String {
    let stripped = strip_sql_semicolon(statement);
    if !is_select_cql(&stripped) || cql_has_limit(&stripped) {
        return stripped;
    }

    format!("{stripped} LIMIT {}", row_limit.saturating_add(1))
}

pub(crate) struct CassandraNormalizedResponse {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<String>>,
    pub truncated: bool,
}

pub(crate) fn normalize_cassandra_response_bounded(
    response: &Value,
    row_limit: u32,
) -> CassandraNormalizedResponse {
    let columns = response
        .get("columns")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(str::to_string)
        .collect::<Vec<_>>();
    let columns = if columns.is_empty() {
        vec!["status".into()]
    } else {
        columns
    };
    let source_rows = response
        .get("rows")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let bounded = bounded_items(source_rows, row_limit);
    let truncated = bounded.truncated || response.get("pagingState").is_some();
    let rows = bounded
        .visible
        .iter()
        .map(|row| {
            row.as_array()
                .into_iter()
                .flatten()
                .map(cql_value_to_string)
                .collect::<Vec<_>>()
        })
        .collect::<Vec<_>>();
    CassandraNormalizedResponse {
        columns,
        rows,
        truncated,
    }
}

fn cassandra_consistency_label(connection: &ResolvedConnectionProfile) -> String {
    connection
        .cassandra_options
        .as_ref()
        .and_then(|options| options.consistency_level.as_deref())
        .unwrap_or("local-quorum")
        .replace('-', "_")
        .to_ascii_uppercase()
}

fn bounded_cassandra_response(mut response: Value, row_limit: u32, truncated: bool) -> Value {
    let paging_state = response.get("pagingState").cloned().unwrap_or(Value::Null);
    if let Some(object) = response.as_object_mut() {
        if let Some(rows) = object.get("rows").and_then(Value::as_array).cloned() {
            object.insert(
                "rows".into(),
                Value::Array(bounded_items(rows, row_limit).visible),
            );
        }
        if truncated {
            object.insert(
                "datapad".into(),
                json!({
                    "truncated": true,
                    "pagingState": paging_state,
                }),
            );
        }
    }
    response
}

pub(crate) fn is_read_only_cql(statement: &str) -> bool {
    let trimmed = statement.trim_start().to_lowercase();
    trimmed.starts_with("select")
        || trimmed.starts_with("describe")
        || trimmed.starts_with("desc")
        || trimmed.starts_with("show")
        || trimmed.starts_with("tracing on")
        || trimmed.starts_with("tracing off")
}

pub(crate) fn cql_needs_partition_key_warning(statement: &str) -> bool {
    let normalized = statement.trim_start().to_lowercase();
    is_select_cql(&normalized) && !normalized.contains("system.") && !normalized.contains(" where ")
}

fn is_select_cql(statement: &str) -> bool {
    statement
        .trim_start()
        .to_ascii_lowercase()
        .starts_with("select")
}

fn cql_has_limit(statement: &str) -> bool {
    statement
        .split(|ch: char| ch.is_whitespace() || ch == ';')
        .any(|token| token.eq_ignore_ascii_case("limit"))
}

fn cql_value_to_string(value: &Value) -> String {
    value
        .as_str()
        .map(str::to_string)
        .unwrap_or_else(|| value.to_string())
}

#[cfg(test)]
#[path = "../../../../tests/unit/adapters/datastores/cassandra/query_tests.rs"]
mod tests;
