use std::collections::HashMap;

use serde_json::{json, Value};

use super::*;

#[test]
fn transfer_scope_preserves_exact_oracle_identifiers() {
    let connection = test_connection();
    let mut request = request(json!({}));
    request.object_name = Some("oracle:object:table:schema:Reporting%3AOwner:Order%20Items".into());

    let (schema, table) = transfer_table(&connection, &request).unwrap();

    assert_eq!(schema, "Reporting:Owner");
    assert_eq!(table, "Order Items");
}

#[test]
fn explicit_target_wins_and_username_fallback_is_unquoted_oracle_case() {
    let connection = test_connection();
    let explicit = request(json!({"schema": "MixedCase", "table": "Events$2026"}));
    assert_eq!(
        transfer_table(&connection, &explicit).unwrap(),
        ("MixedCase".into(), "Events$2026".into())
    );

    let fallback = request(json!({"table": "EVENTS"}));
    assert_eq!(
        transfer_table(&connection, &fallback).unwrap(),
        ("DATAPADPLUSPLUS".into(), "EVENTS".into())
    );
}

#[test]
fn import_requires_an_absolute_existing_file() {
    let request = request(json!({"sourcePath": "relative.csv"}));
    assert_eq!(
        transfer_path(&request, &["sourcePath"], "source")
            .unwrap_err()
            .code,
        "oracle-transfer-path-invalid"
    );
}

#[test]
fn data_pump_location_requires_directory_object_and_dump_file() {
    assert_eq!(
        parse_data_pump_location("data_pump_dir:backup-2026.dmp").unwrap(),
        ("DATA_PUMP_DIR".into(), "backup-2026.dmp".into())
    );
    assert_eq!(
        parse_data_pump_location("C:\\temp\\backup.dmp")
            .unwrap_err()
            .code,
        "oracle-datapump-file-invalid"
    );
    assert_eq!(
        parse_data_pump_location("DATA_PUMP_DIR:../backup.dmp")
            .unwrap_err()
            .code,
        "oracle-datapump-file-invalid"
    );
    assert_eq!(
        parse_data_pump_location("DATA_PUMP_DIR:backup.zip")
            .unwrap_err()
            .code,
        "oracle-datapump-file-invalid"
    );
}

#[test]
fn data_pump_identifiers_are_unquoted_and_bounded() {
    assert!(validate_data_pump_identifier("SALES_2026$ARCHIVE#1", "schema").is_ok());
    assert_eq!(
        validate_data_pump_identifier("Quoted Schema", "schema")
            .unwrap_err()
            .code,
        "oracle-datapump-identifier-invalid"
    );
    assert_eq!(
        validate_data_pump_identifier("1INVALID", "schema")
            .unwrap_err()
            .code,
        "oracle-datapump-identifier-invalid"
    );
}

fn request(parameters: Value) -> OperationExecutionRequest {
    OperationExecutionRequest {
        connection_id: "connection-oracle".into(),
        environment_id: "environment-local".into(),
        operation_id: "oracle.data.import-export".into(),
        object_name: None,
        parameters: parameters.as_object().map(|values| {
            values
                .clone()
                .into_iter()
                .collect::<HashMap<String, Value>>()
        }),
        confirmation_text: Some("CONFIRM ORACLE".into()),
        row_limit: None,
        tab_id: None,
    }
}

fn test_connection() -> ResolvedConnectionProfile {
    ResolvedConnectionProfile {
        id: "connection-oracle".into(),
        name: "Oracle fixture".into(),
        engine: "oracle".into(),
        family: "sql".into(),
        host: "127.0.0.1".into(),
        port: Some(1522),
        database: Some("FREEPDB1".into()),
        username: Some("datapadplusplus".into()),
        password: Some("datapadplusplus".into()),
        connection_string: None,
        redis_options: None,
        memcached_options: None,
        sqlite_options: None,
        postgres_options: None,
        mysql_options: None,
        sqlserver_options: None,
        oracle_options: Some(crate::domain::models::OracleConnectionOptions {
            execution_runtime: Some("managed".into()),
            service_name: Some("FREEPDB1".into()),
            ..crate::domain::models::OracleConnectionOptions::default()
        }),
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
