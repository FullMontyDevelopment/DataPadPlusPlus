use std::collections::BTreeMap;

use serde_json::json;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

use super::*;

#[test]
fn export_query_uses_raw_non_aggregating_series() {
    let value = build_export_query("sys.cpu.user", "24h-ago", "now");

    assert_eq!(value["queries"][0]["aggregator"], json!("none"));
    assert_eq!(value["queries"][0]["rate"], json!(false));
    assert_eq!(value["showTSUIDs"], json!(true));
    assert_eq!(value["msResolution"], json!(true));
}

#[test]
fn native_response_validation_preserves_tags_timestamps_and_numbers() {
    let response = json!([{
        "metric": "sys.cpu.user",
        "tags": {"host": "web-λ", "dc": "af-south-1"},
        "aggregateTags": [],
        "tsuids": ["000001000001000001"],
        "dps": {
            "1725100000000": 9007199254740993_u64,
            "1725100001000": 1.25
        }
    }]);

    assert_eq!(
        validate_export_series(&response, "sys.cpu.user").unwrap(),
        (1, 2)
    );
    assert_eq!(
        response[0]["dps"]["1725100000000"],
        json!(9007199254740993_u64)
    );
}

#[test]
fn response_validation_rejects_aggregated_or_wrong_metric_results() {
    let response = json!([{
        "metric": "sys.cpu.idle",
        "tags": {},
        "aggregateTags": ["host"],
        "dps": {"1725100000000": 1}
    }]);

    assert_eq!(
        validate_export_series(&response, "sys.cpu.user")
            .unwrap_err()
            .code,
        "opentsdb-transfer-response-invalid"
    );
}

#[test]
fn metric_scope_and_plan_are_explicit_about_import_safety() {
    let mut request = request(json!({}));
    request.object_name = Some("metric:sys.cpu.user".into());
    assert_eq!(transfer_metric(&request).unwrap(), "sys.cpu.user");

    let connection = test_connection();
    let parameters = BTreeMap::from([
        ("mode".into(), json!("import")),
        ("metric".into(), json!("sys.cpu.user")),
    ]);
    let plan = opentsdb_transfer_plan(
        &connection,
        "opentsdb.data.import-export",
        None,
        Some(&parameters),
    );
    assert!(plan.generated_request.contains("no atomic create-only"));
    assert!(plan.summary.contains("cannot satisfy"));
}

#[tokio::test]
async fn import_execution_is_rejected_before_network_access() {
    let request = request(json!({"mode": "import"}));
    let connection = test_connection();
    let operation = super::super::catalog::opentsdb_operation_manifests(
        &super::super::catalog::opentsdb_manifest(),
    )
    .into_iter()
    .find(|value| value.id == "opentsdb.data.import-export")
    .unwrap();
    let plan = opentsdb_transfer_plan(&connection, "opentsdb.data.import-export", None, None);

    let result = execute_opentsdb_transfer(
        &connection,
        &request,
        operation,
        plan,
        Vec::new(),
        Vec::new(),
    )
    .await;
    let error = match result {
        Ok(_) => panic!("OpenTSDB import unexpectedly executed"),
        Err(error) => error,
    };

    assert_eq!(error.code, "opentsdb-transfer-import-unsupported");
}

#[tokio::test]
async fn export_execution_writes_a_valid_native_artifact() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move {
        let (mut stream, _) = listener.accept().await.unwrap();
        let mut request = Vec::new();
        let mut buffer = [0_u8; 4096];
        loop {
            let read = stream.read(&mut buffer).await.unwrap();
            request.extend_from_slice(&buffer[..read]);
            let Some(header_end) = request.windows(4).position(|value| value == b"\r\n\r\n") else {
                continue;
            };
            let headers = String::from_utf8_lossy(&request[..header_end]);
            let content_length = headers
                .lines()
                .find_map(|line| {
                    let (name, value) = line.split_once(':')?;
                    name.eq_ignore_ascii_case("content-length")
                        .then(|| value.trim().parse::<usize>().ok())
                        .flatten()
                })
                .unwrap_or_default();
            if request.len() >= header_end + 4 + content_length {
                break;
            }
        }
        let body = r#"[{"metric":"sys.cpu.user","tags":{"host":"web-1"},"aggregateTags":[],"dps":{"1725100000000":1.25}}]"#;
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
        stream.write_all(response.as_bytes()).await.unwrap();
        String::from_utf8(request).unwrap()
    });

    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let path = std::env::temp_dir().join(format!("datapad-opentsdb-{suffix}.json"));
    let mut request = request(json!({
        "mode": "export",
        "format": "opentsdb-json",
        "metric": "sys.cpu.user",
        "start": "1725100000000",
        "end": "1725100001000",
        "targetPath": path.to_string_lossy(),
    }));
    request.object_name = Some("metric:ignored.because.parameter.wins".into());
    let mut connection = test_connection();
    connection.port = Some(address.port());
    let operation = super::super::catalog::opentsdb_operation_manifests(
        &super::super::catalog::opentsdb_manifest(),
    )
    .into_iter()
    .find(|value| value.id == "opentsdb.data.import-export")
    .unwrap();
    let plan = opentsdb_transfer_plan(&connection, "opentsdb.data.import-export", None, None);

    let response = execute_opentsdb_transfer(
        &connection,
        &request,
        operation,
        plan,
        Vec::new(),
        Vec::new(),
    )
    .await
    .unwrap();
    let request_text = server.await.unwrap();
    let artifact: Value = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();

    assert!(request_text.starts_with("POST /api/query HTTP/1.1"));
    assert!(request_text.contains(r#""aggregator":"none""#));
    assert_eq!(artifact["formatVersion"], json!(1));
    assert_eq!(artifact["series"][0]["tags"]["host"], json!("web-1"));
    assert_eq!(response.metadata.unwrap()["pointCount"], json!(1));
    let _ = std::fs::remove_file(path);
}

fn request(parameters: Value) -> OperationExecutionRequest {
    OperationExecutionRequest {
        connection_id: "connection-opentsdb".into(),
        environment_id: "environment-local".into(),
        operation_id: "opentsdb.data.import-export".into(),
        object_name: None,
        parameters: parameters
            .as_object()
            .map(|values| values.clone().into_iter().collect()),
        confirmation_text: None,
        row_limit: None,
        tab_id: None,
    }
}

fn test_connection() -> ResolvedConnectionProfile {
    ResolvedConnectionProfile {
        id: "connection-opentsdb".into(),
        name: "OpenTSDB fixture".into(),
        engine: "opentsdb".into(),
        family: "timeseries".into(),
        host: "127.0.0.1".into(),
        port: Some(1),
        database: None,
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
