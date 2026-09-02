use std::collections::{BTreeMap, HashMap};

use serde_json::json;

use super::*;

#[test]
fn extracts_vector_and_matrix_samples_without_display_truncation() {
    let vector = json!({
        "status": "success",
        "data": {
            "resultType": "vector",
            "result": [{
                "metric": {"__name__": "up", "job": "prometheus"},
                "value": [1761234567.125, "1"]
            }]
        }
    });
    let samples = extract_samples(&vector).unwrap();
    assert_eq!(samples.len(), 1);
    assert_eq!(samples[0].timestamp, "1761234567.125");
    assert_eq!(samples[0].value, "1");

    let matrix = json!({
        "status": "success",
        "data": {
            "resultType": "matrix",
            "result": [{
                "metric": {"__name__": "temperature", "room": "室内"},
                "values": [[1761234567, "12.5"], [1761234582, "NaN"]]
            }]
        }
    });
    let samples = extract_samples(&matrix).unwrap();
    assert_eq!(samples.len(), 2);
    assert_eq!(samples[1].value, "NaN");
}

#[test]
fn openmetrics_preserves_labels_values_and_timestamps() {
    let samples = vec![PrometheusSample {
        metric: Map::from_iter([
            ("__name__".into(), json!("http_requests_total")),
            ("path".into(), json!("/api/\"quoted\"")),
            ("region".into(), json!("za\nwest")),
        ]),
        timestamp: "1761234567.125".into(),
        value: "+Inf".into(),
    }];
    let path = std::env::temp_dir().join(format!(
        "datapad-prometheus-openmetrics-{}.prom",
        std::process::id()
    ));
    let temporary = temporary_output_path(&path);
    let file = fs::File::create(&temporary).unwrap();
    let mut output = BufWriter::new(file);
    write_openmetrics(&mut output, &samples).unwrap();
    output.flush().unwrap();
    drop(output);
    let encoded = fs::read_to_string(&temporary).unwrap();
    assert!(encoded.contains("http_requests_total{path=\"/api/\\\"quoted\\\"\",region=\"za\\nwest\"} +Inf 1761234567.125"));
    assert!(encoded.ends_with("# EOF\n"));
    fs::remove_file(temporary).unwrap();
}

#[test]
fn range_query_requires_start_end_and_step_together() {
    let incomplete = request(json!({
        "query": "up",
        "start": "1h"
    }));
    assert_eq!(
        query_path(&incomplete, "up").unwrap_err().code,
        "prometheus-transfer-range-invalid"
    );

    let complete = request(json!({
        "query": "up",
        "start": "2026-08-31T12:00:00Z",
        "end": "2026-08-31T13:00:00Z",
        "step": "15s"
    }));
    let path = query_path(&complete, "up").unwrap();
    assert!(path.starts_with("/api/v1/query_range?"));
    assert!(path.contains("step=15s"));
}

#[test]
fn transfer_plan_does_not_claim_import_or_write_support() {
    let connection = test_connection();
    let parameters = BTreeMap::from([("query".into(), json!("up"))]);
    let plan = prometheus_transfer_plan(
        &connection,
        "prometheus.data.import-export",
        None,
        Some(&parameters),
    );
    assert!(plan.summary.contains("instant"));
    assert!(plan.generated_request.starts_with("GET "));
    assert!(!plan.destructive);
}

#[tokio::test]
#[cfg_attr(not(feature = "live-fixtures"), ignore = "requires live fixtures")]
async fn live_prometheus_exports_native_json_openmetrics_and_csv() {
    if std::env::var("DATAPADPLUSPLUS_FIXTURE_RUN").ok().as_deref() != Some("1") {
        return;
    }
    let connection = test_connection();
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis();
    for (format, extension) in [
        ("prometheus-json", "json"),
        ("openmetrics", "prom"),
        ("csv", "csv"),
    ] {
        let path =
            std::env::temp_dir().join(format!("datapad-prometheus-{suffix}-{format}.{extension}"));
        let request = request(json!({
            "mode": "export",
            "format": format,
            "query": "label_replace(vector(1), \"__name__\", \"datapad_transfer_fixture\", \"\", \"\")",
            "targetPath": path.to_string_lossy(),
        }));
        let operation = DatastoreOperationManifest {
            id: "prometheus.data.import-export".into(),
            engine: "prometheus".into(),
            family: "timeseries".into(),
            label: "Export".into(),
            scope: "query".into(),
            risk: "safe".into(),
            required_capabilities: vec![],
            supported_renderers: vec![],
            description: String::new(),
            requires_confirmation: false,
            execution_support: "live".into(),
            disabled_reason: None,
            preview_only: Some(false),
        };
        let plan =
            prometheus_transfer_plan(&connection, "prometheus.data.import-export", None, None);
        let response =
            execute_prometheus_transfer(&connection, &request, operation, plan, vec![], vec![])
                .await
                .unwrap();
        assert!(response.executed);
        assert!(response.metadata.unwrap()["sampleCount"].as_u64().unwrap() >= 1);
        let artifact = fs::read_to_string(&path).unwrap();
        match format {
            "prometheus-json" => assert!(artifact.contains("\"resultType\"")),
            "openmetrics" => assert!(artifact.contains("datapad_transfer_fixture")),
            "csv" => assert!(artifact.starts_with("metric,labels,timestamp,value")),
            _ => unreachable!(),
        }
        fs::remove_file(path).unwrap();
    }
}

fn request(parameters: Value) -> OperationExecutionRequest {
    OperationExecutionRequest {
        connection_id: "connection-prometheus".into(),
        environment_id: "environment-local".into(),
        operation_id: "prometheus.data.import-export".into(),
        object_name: None,
        parameters: parameters
            .as_object()
            .map(|values| values.clone().into_iter().collect::<HashMap<_, _>>()),
        confirmation_text: None,
        row_limit: None,
        tab_id: None,
    }
}

fn test_connection() -> ResolvedConnectionProfile {
    ResolvedConnectionProfile {
        id: "connection-prometheus".into(),
        name: "Prometheus fixture".into(),
        engine: "prometheus".into(),
        family: "time-series".into(),
        host: "127.0.0.1".into(),
        port: Some(9091),
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
        read_only: true,
    }
}
