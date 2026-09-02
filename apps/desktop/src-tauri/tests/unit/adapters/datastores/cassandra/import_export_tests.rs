use super::*;
use serde_json::json;
use std::collections::HashMap;

fn connection() -> ResolvedConnectionProfile {
    ResolvedConnectionProfile {
        id: "cassandra".into(),
        name: "Cassandra".into(),
        engine: "cassandra".into(),
        family: "widecolumn".into(),
        host: "127.0.0.1".into(),
        port: Some(9042),
        database: Some("Mixed Case".into()),
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
        read_only: false,
    }
}

fn request(object_name: Option<&str>, parameters: Value) -> OperationExecutionRequest {
    OperationExecutionRequest {
        connection_id: "connection".into(),
        environment_id: "environment".into(),
        operation_id: "cassandra.data.import-export".into(),
        object_name: object_name.map(str::to_string),
        parameters: parameters.as_object().map(|items| {
            items
                .iter()
                .map(|(key, value)| (key.clone(), value.clone()))
                .collect::<HashMap<_, _>>()
        }),
        confirmation_text: None,
        row_limit: None,
        tab_id: None,
    }
}

#[test]
fn transfer_target_preserves_exact_quoted_identifiers() {
    let mut connection = connection();
    let transfer = request(Some("Quoted.Table"), json!({ "table": "Quoted\"Table" }));
    assert_eq!(
        transfer_target(&connection, &transfer).unwrap(),
        ("Mixed Case".into(), "Quoted\"Table".into())
    );
    assert_eq!(
        qualified_name("Mixed Case", "Quoted\"Table"),
        "\"Mixed Case\".\"Quoted\"\"Table\""
    );
    connection.database = None;
    assert!(transfer_target(&connection, &request(None, json!({}))).is_err());
}

#[test]
fn cql_json_lines_require_one_object_per_nonempty_line() {
    assert_eq!(
        parse_cql_json_object(r#"{"id":1,"amount":"12.50"}"#, 1).unwrap(),
        json!({ "id": 1, "amount": "12.50" })
    );
    assert_eq!(
        parse_cql_json_object("[]", 2).unwrap_err().code,
        "cassandra-transfer-document-invalid"
    );
    assert_eq!(
        parse_cql_json_object("{", 3).unwrap_err().code,
        "cassandra-transfer-document-invalid"
    );
}

#[test]
fn only_native_cql_json_lines_are_advertised() {
    assert!(validate_format(&request(None, json!({ "format": "cql-json-lines" }))).is_ok());
    assert!(validate_format(&request(None, json!({ "format": "ndjson" }))).is_ok());
    assert_eq!(
        validate_format(&request(None, json!({ "format": "csv" })))
            .unwrap_err()
            .code,
        "cassandra-transfer-format-invalid"
    );
}

#[test]
fn partial_failures_report_confirmed_count_without_row_contents() {
    let error = partial_import_error("cassandra-transfer-conflict", 7, 9, "Conflict.");
    assert!(error.message.contains("line 9"));
    assert!(error.message.contains("7 confirmed insert(s)"));
    assert!(error.message.contains("cross-partition rollback"));
}

#[tokio::test]
#[cfg_attr(not(feature = "live-fixtures"), ignore = "requires live fixtures")]
async fn cassandra_live_transfer_round_trips_native_json_and_rejects_conflicts() {
    if std::env::var("DATAPADPLUSPLUS_FIXTURE_RUN").unwrap_or_default() != "1" {
        return;
    }
    let port = std::env::var("DATAPADPLUSPLUS_CASSANDRA_PORT")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(9043);
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let source_table = format!("transfer_source_{suffix}");
    let target_table = format!("transfer_target_{suffix}");
    let mut connection = connection();
    connection.port = Some(port);
    connection.database = Some("datapadplusplus".into());
    let session = connect_cassandra(&connection)
        .await
        .expect("connect to fixture Cassandra");
    let schema = "(tenant_id int, item_id uuid, amount decimal, recorded_at timestamp, payload blob, labels list<text>, attributes map<text, text>, primary key ((tenant_id), item_id))";
    for table in [&source_table, &target_table] {
        session
            .query_unpaged(format!("CREATE TABLE datapadplusplus.{table} {schema}"), ())
            .await
            .expect("create transfer table");
    }
    for statement in [
        format!("INSERT INTO datapadplusplus.{source_table} (tenant_id, item_id, amount, recorded_at, payload, labels, attributes) VALUES (1, 11111111-1111-4111-8111-111111111111, 1234.567, '2026-01-02T03:04:05Z', 0x0001ff, ['alpha', 'β'], {{'region':'ZA'}})"),
        format!("INSERT INTO datapadplusplus.{source_table} (tenant_id, item_id, amount, recorded_at, payload, labels, attributes) VALUES (2, 22222222-2222-4222-8222-222222222222, -0.010, '2026-02-03T04:05:06Z', 0xcafe, ['unicode-λ'], {{'empty':''}})"),
    ] {
        session
            .query_unpaged(statement, ())
            .await
            .expect("seed transfer source");
    }

    let export_path = std::env::temp_dir().join(format!("datapad-cassandra-{suffix}.jsonl"));
    let result = export_cassandra_table(
        &connection,
        "datapadplusplus",
        &source_table,
        &export_path,
        false,
    )
    .await
    .expect("export Cassandra table");
    assert_eq!(result.0, 2);
    assert!(result.1 > 0);
    let documents = std::fs::read_to_string(&export_path)
        .expect("read export")
        .lines()
        .map(|line| serde_json::from_str::<Value>(line).expect("valid CQL JSON line"))
        .collect::<Vec<_>>();
    assert_eq!(documents.len(), 2);
    assert!(documents.iter().all(Value::is_object));

    let imported =
        import_cassandra_table(&connection, "datapadplusplus", &target_table, &export_path)
            .await
            .expect("import Cassandra table");
    assert_eq!(imported.inserted_count, 2);
    let conflict =
        import_cassandra_table(&connection, "datapadplusplus", &target_table, &export_path)
            .await
            .unwrap_err();
    assert_eq!(conflict.code, "cassandra-transfer-conflict");
    assert!(conflict.message.contains("0 confirmed insert(s)"));

    let target_export_path =
        std::env::temp_dir().join(format!("datapad-cassandra-target-{suffix}.jsonl"));
    export_cassandra_table(
        &connection,
        "datapadplusplus",
        &target_table,
        &target_export_path,
        false,
    )
    .await
    .expect("export imported Cassandra table");
    let mut source_lines = std::fs::read_to_string(&export_path)
        .expect("read source export")
        .lines()
        .map(str::to_string)
        .collect::<Vec<_>>();
    let mut target_lines = std::fs::read_to_string(&target_export_path)
        .expect("read target export")
        .lines()
        .map(str::to_string)
        .collect::<Vec<_>>();
    source_lines.sort();
    target_lines.sort();
    assert_eq!(target_lines, source_lines);

    for table in [&source_table, &target_table] {
        let _ = session
            .query_unpaged(format!("DROP TABLE datapadplusplus.{table}"), ())
            .await;
    }
    let _ = std::fs::remove_file(export_path);
    let _ = std::fs::remove_file(target_export_path);
}
