use serde_json::json;

use super::{
    bounded_cassandra_response, cassandra_request_payload, cassandra_statement_for_execution,
    cql_needs_partition_key_warning, execute_cassandra_query, is_read_only_cql,
    normalize_cassandra_response_bounded, CassandraAdapter,
};
use crate::domain::models::{ExecutionRequest, ResolvedConnectionProfile};

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
        mongodb_options: None,
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
    assert_eq!(payload["consistency"], "LOCAL_QUORUM");
    assert_eq!(payload["guardrails"]["mutationPreviewOnly"], true);
}

#[test]
fn cassandra_empty_response_does_not_invent_preview_rows() {
    let response = json!({ "columns": ["account_id"], "rows": [] });
    let result = normalize_cassandra_response_bounded(&response, 25);

    assert_eq!(result.columns, vec!["account_id"]);
    assert!(result.rows.is_empty());
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

#[tokio::test]
async fn cassandra_live_fixture_returns_real_rows() {
    if std::env::var("DATAPADPLUSPLUS_FIXTURE_RUN").unwrap_or_default() != "1" {
        return;
    }
    let port = std::env::var("DATAPADPLUSPLUS_CASSANDRA_PORT")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(9043);
    let mut connection = connection();
    connection.id = "fixture-cassandra".into();
    connection.name = "Fixture Cassandra".into();
    connection.host = "127.0.0.1".into();
    connection.port = Some(port);
    connection.database = Some("datapadplusplus".into());

    let result = execute_cassandra_query(
        &CassandraAdapter,
        &connection,
        &ExecutionRequest {
            execution_id: None,
            tab_id: "tab-fixture-cassandra".into(),
            connection_id: connection.id.clone(),
            environment_id: "env-local-demo".into(),
            language: "cql".into(),
            query_text: "select account_id, order_id, status, total_amount, updated_at from datapadplusplus.orders_by_account where account_id = 1 limit 25;".into(),
            execution_input_mode: None,
            script_text: None,
            selected_text: None,
            mode: Some("full".into()),
            row_limit: Some(25),
            document_efficiency_mode: None,
            confirmed_guardrail_id: None,
            builder_state: None,
            scoped_target: None,
        },
        Vec::new(),
    )
    .await
    .expect("fixture Cassandra query");

    let table = result
        .payloads
        .iter()
        .find(|payload| payload["renderer"] == "table")
        .expect("table payload");
    assert_eq!(
        table["columns"],
        json!([
            "account_id",
            "order_id",
            "status",
            "total_amount",
            "updated_at"
        ])
    );
    assert!(table["rows"]
        .as_array()
        .is_some_and(|rows| !rows.is_empty()));
    assert!(table["rows"]
        .as_array()
        .into_iter()
        .flatten()
        .all(|row| !row.to_string().contains("cql-request-built")));
}
