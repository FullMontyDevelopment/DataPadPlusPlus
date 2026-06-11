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
        memcached_options: None,
        sqlite_options: None,
        postgres_options: None,
        mysql_options: None,
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
