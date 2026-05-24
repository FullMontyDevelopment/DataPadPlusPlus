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

    let row_limit = bounded_page_size(
        request
            .row_limit
            .or(Some(adapter.execution_capabilities().default_row_limit)),
    );
    notices.push(QueryExecutionNotice {
        code: "cassandra-cql-contract".into(),
        level: "info".into(),
        message:
            "Cassandra CQL was normalized as a guarded request-builder payload pending native binary protocol execution."
                .into(),
    });

    let request_payload = cassandra_request_payload(connection, statement, row_limit);
    let response = preview_cassandra_response(connection, statement, row_limit);
    let (columns, rows) = normalize_cassandra_response(&response, row_limit);
    let row_count = rows.len() as u32;
    let profile_payload = payload_profile(
        "Cassandra tracing and partition-key guardrails.",
        json!({
            "contactPoint": cassandra_contact_point(connection),
            "keyspace": cassandra_keyspace(connection),
            "partitionKeyRequired": cql_needs_partition_key_warning(statement),
            "tracing": false
        }),
    );
    let payloads = vec![
        payload_table(columns, rows),
        payload_json(response),
        payload_plan(
            "json",
            request_payload.clone(),
            "CQL request builder payload with consistency and partition-key guardrails.",
        ),
        profile_payload,
        payload_metrics(json!([
            {
                "name": "cassandra.query.partition_key_guard",
                "value": if cql_needs_partition_key_warning(statement) { 1 } else { 0 },
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
        summary: format!("Cassandra CQL contract normalized {row_count} row(s)."),
        default_renderer: &default_renderer,
        renderer_modes,
        payloads,
        notices,
        duration_ms: duration_ms(started),
        row_limit: Some(row_limit),
        truncated: false,
        explain_payload: None,
    }))
}

pub(crate) fn cassandra_request_payload(
    connection: &ResolvedConnectionProfile,
    statement: &str,
    row_limit: u32,
) -> Value {
    json!({
        "protocol": "cql-native-v4",
        "contactPoint": cassandra_contact_point(connection),
        "keyspace": cassandra_keyspace(connection),
        "statement": strip_sql_semicolon(statement),
        "consistency": "LOCAL_QUORUM",
        "pageSize": row_limit,
        "guardrails": {
            "mutationPreviewOnly": true,
            "partitionKeyFirst": true,
            "allowFilteringWarning": statement.to_lowercase().contains("allow filtering")
        }
    })
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

pub(crate) fn normalize_cassandra_response(
    response: &Value,
    row_limit: u32,
) -> (Vec<String>, Vec<Vec<String>>) {
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
    let rows = response
        .get("rows")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
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
        (columns, vec![vec!["requestBuilt".into()]])
    } else {
        (columns, rows)
    }
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
    normalized.starts_with("select")
        && !normalized.contains("system.")
        && !normalized.contains(" where ")
        && !normalized.contains(" limit ")
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
        cassandra_request_payload, cql_needs_partition_key_warning, is_read_only_cql,
        normalize_cassandra_response, preview_cassandra_response,
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
            read_only: true,
        }
    }

    #[test]
    fn cassandra_request_payload_sets_keyspace_and_page_size() {
        let payload = cassandra_request_payload(&connection(), "select * from orders", 50);

        assert_eq!(payload["keyspace"], "commerce");
        assert_eq!(payload["pageSize"], 50);
        assert_eq!(payload["guardrails"]["mutationPreviewOnly"], true);
    }

    #[test]
    fn cassandra_preview_response_normalizes_rows() {
        let response = preview_cassandra_response(&connection(), "select * from orders", 25);
        let (columns, rows) = normalize_cassandra_response(&response, 25);

        assert_eq!(columns, vec!["keyspace", "status", "row_limit"]);
        assert_eq!(rows[0][1], "cql-request-built");
    }

    #[test]
    fn cassandra_response_respects_row_limit() {
        let response = json!({
            "columns": ["id"],
            "rows": [["1"], ["2"]]
        });
        let (_, rows) = normalize_cassandra_response(&response, 1);

        assert_eq!(rows.len(), 1);
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
        assert!(!cql_needs_partition_key_warning(
            "select * from orders where account_id = ?"
        ));
        assert!(!cql_needs_partition_key_warning(
            "select * from system.local"
        ));
    }
}
