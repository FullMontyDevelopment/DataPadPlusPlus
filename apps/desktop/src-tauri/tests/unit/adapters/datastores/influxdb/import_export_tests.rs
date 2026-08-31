use std::collections::{BTreeMap, HashMap};

use serde_json::{json, Map, Value};

use super::*;

fn request(parameters: Value) -> OperationExecutionRequest {
    OperationExecutionRequest {
        connection_id: "connection-influx".into(),
        environment_id: "environment-local".into(),
        operation_id: "influxdb.data.import-export".into(),
        object_name: None,
        parameters: parameters
            .as_object()
            .map(|values| values.clone().into_iter().collect::<HashMap<_, _>>()),
        confirmation_text: None,
        row_limit: None,
        tab_id: None,
    }
}

#[test]
fn line_protocol_encoder_preserves_native_values_and_escapes_names() {
    let schema = InfluxSchema {
        tags: BTreeSet::from(["device id".into(), "region".into()]),
        fields: BTreeMap::from([
            ("active".into(), "boolean".into()),
            ("count".into(), "integer".into()),
            ("note".into(), "string".into()),
            ("value".into(), "float".into()),
        ]),
    };
    let row = Map::from_iter([
        ("time".into(), json!(1_761_234_567_890_123_456_i64)),
        ("device id".into(), json!("alpha,one")),
        ("region".into(), json!("za=west")),
        ("active".into(), json!(true)),
        ("count".into(), json!(7)),
        ("note".into(), json!("λ \"room\" \\ sensor")),
        ("value".into(), json!(12.5)),
    ]);

    let encoded = encode_line_protocol_row("sensor data", &row, &schema).unwrap();

    assert_eq!(
        encoded,
        "sensor\\ data,device\\ id=alpha\\,one,region=za\\=west active=true,count=7i,note=\"λ \\\"room\\\" \\\\ sensor\",value=12.5 1761234567890123456"
    );
}

#[test]
fn line_protocol_shape_requires_fields_and_integer_timestamp() {
    assert!(validate_line_protocol_shape("metrics value=1.5 123", 1).is_ok());
    assert!(validate_line_protocol_shape("metrics value=\"room one\" 123", 1).is_ok());
    assert_eq!(
        validate_line_protocol_shape("metrics 123", 1)
            .unwrap_err()
            .code,
        "influxdb-transfer-line-invalid"
    );
    assert_eq!(
        validate_line_protocol_shape("metrics value=1.5 yesterday", 1)
            .unwrap_err()
            .code,
        "influxdb-transfer-line-invalid"
    );
}

#[test]
fn export_target_understands_explorer_measurement_scope() {
    let connection = test_connection();
    let mut request = request(json!({}));
    request.object_name = Some("measurement:metrics:order_latency".into());

    assert_eq!(
        export_target(&connection, &request).unwrap(),
        ("metrics".into(), "order_latency".into())
    );
}

#[test]
fn import_requires_a_new_target_database_and_fail_policy() {
    let missing = request(json!({ "mode": "import" }));
    assert_eq!(
        required_target_database(&missing).unwrap_err().code,
        "influxdb-transfer-target-invalid"
    );

    let selected = request(json!({
        "mode": "import",
        "targetDatabase": "metrics_copy",
        "conflictPolicy": "fail"
    }));
    assert_eq!(required_target_database(&selected).unwrap(), "metrics_copy");
}

#[test]
fn transfer_plan_describes_new_database_rollback_boundary() {
    let connection = test_connection();
    let parameters = BTreeMap::from([
        ("mode".into(), json!("import")),
        ("targetDatabase".into(), json!("metrics_copy")),
    ]);

    let plan = influxdb_transfer_plan(
        &connection,
        "influxdb.data.import-export",
        None,
        Some(&parameters),
    );

    assert!(plan.summary.contains("metrics_copy"));
    assert!(plan.generated_request.contains("/write"));
    assert!(plan.estimated_scan_impact.unwrap().contains("dropped"));
}

fn test_connection() -> ResolvedConnectionProfile {
    ResolvedConnectionProfile {
        id: "connection-influx".into(),
        name: "Influx fixture".into(),
        engine: "influxdb".into(),
        host: "127.0.0.1".into(),
        port: Some(8087),
        database: Some("metrics".into()),
        username: None,
        password: None,
        family: "time-series".into(),
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

#[tokio::test]
async fn live_influxdb_line_protocol_round_trip_and_rollback() {
    if std::env::var("DATAPADPLUSPLUS_FIXTURE_RUN").ok().as_deref() != Some("1") {
        return;
    }
    let connection = test_connection();
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let source_database = format!("transfer_source_{suffix}");
    let target_database = format!("transfer_target_{suffix}");
    let failed_database = format!("transfer_failed_{suffix}");
    let measurement = "telemetry native";
    let temp = std::env::temp_dir();
    let export_path = temp.join(format!("datapad-influx-{suffix}.lp"));
    let invalid_path = temp.join(format!("datapad-influx-invalid-{suffix}.lp"));

    execute_influxql(
        &connection,
        "metrics",
        &format!(
            "CREATE DATABASE {}",
            quote_influx_identifier(&source_database)
        ),
    )
    .await
    .unwrap();
    let seed = concat!(
        "telemetry\\ native,device\\ id=alpha\\,one,region=za active=true,count=7i,note=\"λ room\",value=12.5 1761234567890123456\n",
        "telemetry\\ native,device\\ id=beta,region=eu active=false,count=9i,note=\"室内\",value=-2.25 1761234567890123457\n"
    );
    write_batch(&connection, &source_database, seed.into())
        .await
        .unwrap();

    let exported = export_measurement(
        &connection,
        &source_database,
        measurement,
        &export_path,
        false,
    )
    .await
    .unwrap();
    assert_eq!(exported.points, 2);
    let artifact = fs::read_to_string(&export_path).unwrap();
    assert!(artifact.contains("count=7i"));
    assert!(artifact.contains("note=\"λ room\""));
    assert!(artifact.contains("1761234567890123456"));

    let imported = import_line_protocol(&connection, &export_path, &target_database)
        .await
        .unwrap();
    assert_eq!(imported.points_written, 2);
    let target_query = influx_query(
        &connection,
        &format!(
            "{}&epoch=ns",
            influxdb_query_path(
                &target_database,
                &format!(
                    "SELECT * FROM {} ORDER BY time ASC",
                    quote_influx_identifier(measurement)
                )
            )
        ),
    )
    .await
    .unwrap();
    let target_rows = series_rows(&target_query).unwrap();
    assert_eq!(target_rows.len(), 2);
    assert_eq!(target_rows[0].get("count"), Some(&json!(7)));
    assert_eq!(target_rows[0].get("note"), Some(&json!("λ room")));
    assert_eq!(target_rows[1].get("active"), Some(&json!(false)));

    let conflict = import_line_protocol(&connection, &export_path, &target_database)
        .await
        .unwrap_err();
    assert_eq!(conflict.code, "influxdb-transfer-target-exists");

    fs::write(
        &invalid_path,
        "bad value=not-a-native-field 1761234567890123456\n",
    )
    .unwrap();
    let failed = import_line_protocol(&connection, &invalid_path, &failed_database)
        .await
        .unwrap_err();
    assert_eq!(failed.code, "influxdb-transfer-write-failed");
    let databases = influx_query(
        &connection,
        &influxdb_query_path("metrics", "SHOW DATABASES"),
    )
    .await
    .unwrap();
    assert!(!series_rows(&databases)
        .unwrap()
        .iter()
        .any(|row| { row.get("name").and_then(Value::as_str) == Some(failed_database.as_str()) }));

    for database in [&source_database, &target_database] {
        let _ = execute_influxql(
            &connection,
            "metrics",
            &format!("DROP DATABASE {}", quote_influx_identifier(database)),
        )
        .await;
    }
    let _ = fs::remove_file(export_path);
    let _ = fs::remove_file(invalid_path);
}
