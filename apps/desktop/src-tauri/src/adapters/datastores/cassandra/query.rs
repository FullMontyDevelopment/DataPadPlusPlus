use serde_json::{json, Value};

use super::super::super::*;
use super::connection::{cassandra_contact_point, cassandra_keyspace};
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

    if batch_statements.len() > 1 {
        let mut sections = Vec::new();
        let mut total_rows = 0usize;
        let mut truncated = false;

        for statement in &batch_statements {
            let statement_started = Instant::now();
            let execution_statement = cassandra_statement_for_execution(&statement.text, row_limit);
            let response = preview_cassandra_response(connection, &execution_statement, row_limit);
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
    notices.push(QueryExecutionNotice {
        code: "cassandra-cql-contract".into(),
        level: "info".into(),
        message:
            "Cassandra CQL was normalized as a guarded request-builder payload pending native binary protocol execution."
                .into(),
    });
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
    let response = preview_cassandra_response(connection, &execution_statement, row_limit);
    let normalized = normalize_cassandra_response_bounded(&response, row_limit);
    let columns = normalized.columns;
    let rows = normalized.rows;
    let truncated = normalized.truncated;
    let row_count = rows.len() as u32;
    let profile_payload = payload_profile(
        "Cassandra tracing and partition-key guardrails.",
        json!({
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
            "CQL request builder payload with consistency and partition-key guardrails.",
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
            format!("Cassandra CQL contract loaded the first {row_count} row(s).")
        } else {
            format!("Cassandra CQL contract normalized {row_count} row(s).")
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
        "consistency": "LOCAL_QUORUM",
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

pub(crate) fn preview_cassandra_response(
    connection: &ResolvedConnectionProfile,
    statement: &str,
    row_limit: u32,
) -> Value {
    json!({
        "columns": ["keyspace", "status", "row_limit"],
        "rows": [[
            cassandra_keyspace(connection),
            "cql-request-built",
            row_limit.to_string()
        ]],
        "statement": statement,
        "warnings": if cql_needs_partition_key_warning(statement) {
            vec!["Cassandra queries should include a complete partition key unless this is a metadata/system-table query."]
        } else {
            Vec::<&str>::new()
        }
    })
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
    let truncated = source_rows.len() > row_limit as usize || response.get("pagingState").is_some();
    let rows = source_rows
        .iter()
        .take(row_limit as usize)
        .map(|row| {
            row.as_array()
                .into_iter()
                .flatten()
                .map(cql_value_to_string)
                .collect::<Vec<_>>()
        })
        .collect::<Vec<_>>();
    if rows.is_empty() {
        CassandraNormalizedResponse {
            columns,
            rows: vec![vec!["requestBuilt".into()]],
            truncated: false,
        }
    } else {
        CassandraNormalizedResponse {
            columns,
            rows,
            truncated,
        }
    }
}

fn bounded_cassandra_response(mut response: Value, row_limit: u32, truncated: bool) -> Value {
    let paging_state = response.get("pagingState").cloned().unwrap_or(Value::Null);
    if let Some(object) = response.as_object_mut() {
        if let Some(rows) = object.get("rows").and_then(Value::as_array).cloned() {
            object.insert(
                "rows".into(),
                Value::Array(rows.into_iter().take(row_limit as usize).collect()),
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
mod tests {
    use serde_json::json;

    use super::{
        bounded_cassandra_response, cassandra_request_payload, cassandra_statement_for_execution,
        cql_needs_partition_key_warning, is_read_only_cql, normalize_cassandra_response_bounded,
        preview_cassandra_response,
    };
    use crate::domain::models::ResolvedConnectionProfile;

    fn connection() -> ResolvedConnectionProfile {
        ResolvedConnectionProfile {
            id: "conn-cassandra".into(),
            name: "Cassandra".into(),
            engine: "cassandra".into(),
            family: "widecolumn".into(),
            host: "node1".into(),
            port: Some(9042),
            database: Some("commerce".into()),
            username: None,
            password: None,
            connection_string: None,
            redis_options: None,
            sqlite_options: None,
            sqlserver_options: None,
            oracle_options: None,
            dynamo_db_options: None,
            cassandra_options: None,
            cosmos_db_options: None,
            search_options: None,
            time_series_options: None,
            graph_options: None,
            warehouse_options: None,
            read_only: true,
        }
    }

    #[test]
    fn cassandra_request_payload_sets_keyspace_and_page_size() {
        let payload = cassandra_request_payload(&connection(), "select * from orders", 50, true);

        assert_eq!(payload["keyspace"], "commerce");
        assert_eq!(payload["pageSize"], 50);
        assert_eq!(payload["tracing"], true);
        assert_eq!(payload["guardrails"]["mutationPreviewOnly"], true);
    }

    #[test]
    fn cassandra_preview_response_normalizes_rows() {
        let response = preview_cassandra_response(&connection(), "select * from orders", 25);
        let result = normalize_cassandra_response_bounded(&response, 25);

        assert_eq!(result.columns, vec!["keyspace", "status", "row_limit"]);
        assert_eq!(result.rows[0][1], "cql-request-built");
    }

    #[test]
    fn cassandra_response_respects_row_limit() {
        let response = json!({
            "columns": ["id"],
            "rows": [["1"], ["2"]]
        });
        let result = normalize_cassandra_response_bounded(&response, 1);

        assert_eq!(result.rows.len(), 1);
        assert!(result.truncated);
    }

    #[test]
    fn cassandra_read_only_guard_detects_mutations() {
        assert!(is_read_only_cql("select * from table"));
        assert!(is_read_only_cql("describe keyspaces"));
        assert!(!is_read_only_cql("insert into table (id) values (1)"));
        assert!(!is_read_only_cql("create table t (id int primary key)"));
    }

    #[test]
    fn cassandra_partition_warning_targets_broad_selects() {
        assert!(cql_needs_partition_key_warning("select * from orders"));
        assert!(cql_needs_partition_key_warning(
            "select * from orders limit 10"
        ));
        assert!(!cql_needs_partition_key_warning(
            "select * from orders where account_id = ?"
        ));
        assert!(!cql_needs_partition_key_warning(
            "select * from system.local"
        ));
    }

    #[test]
    fn cassandra_statement_for_execution_adds_limit_to_unbounded_selects() {
        assert_eq!(
            cassandra_statement_for_execution("select * from orders;", 50),
            "select * from orders LIMIT 51"
        );
        assert_eq!(
            cassandra_statement_for_execution("select * from orders limit 10;", 50),
            "select * from orders limit 10"
        );
        assert_eq!(
            cassandra_statement_for_execution("describe keyspaces;", 50),
            "describe keyspaces"
        );
    }

    #[test]
    fn cassandra_bounded_response_preserves_paging_state() {
        let response = json!({
            "columns": ["id"],
            "rows": [["1"], ["2"], ["3"]],
            "pagingState": "abc"
        });

        let bounded = bounded_cassandra_response(response, 2, true);

        assert_eq!(bounded["rows"].as_array().unwrap().len(), 2);
        assert_eq!(bounded["datapad"]["truncated"], true);
        assert_eq!(bounded["datapad"]["pagingState"], "abc");
    }
}
