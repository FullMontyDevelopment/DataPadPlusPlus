use serde_json::json;

use super::{
    bucket_child_nodes, diagnostic_records, first_column_values, influx_authorization_scopes,
    influx_object_view, quote_influx_identifier, retention_label, root_nodes, series_table_records,
    InfluxDiagnosticCounts,
};
use crate::domain::models::ResolvedConnectionProfile;

#[test]
fn influxdb_first_column_values_reads_show_results() {
    let value = json!({
        "results": [{
            "series": [{
                "columns": ["name"],
                "values": [["cpu"], ["mem"]]
            }]
        }]
    });

    assert_eq!(first_column_values(&value), vec!["cpu", "mem"]);
}

#[test]
fn influxdb_identifier_quote_escapes_quotes() {
    assert_eq!(quote_influx_identifier("cpu\"load"), "\"cpu\\\"load\"");
}

#[test]
fn influxdb_root_uses_native_bucket_and_diagnostics_sections() {
    let nodes = root_nodes(&connection());
    let labels = nodes
        .iter()
        .map(|node| node.label.as_str())
        .collect::<Vec<_>>();

    assert_eq!(labels, vec!["Buckets", "Tasks", "Tokens", "Diagnostics"]);
    assert_eq!(nodes[0].id, "influx:buckets");
    assert_eq!(nodes[0].scope.as_deref(), Some("influx:buckets"));
}

#[test]
fn influxdb_bucket_children_match_object_view_sections() {
    let nodes = bucket_child_nodes(&connection(), "bucket:telemetry");
    let labels = nodes
        .iter()
        .map(|node| node.label.as_str())
        .collect::<Vec<_>>();

    assert_eq!(
        labels,
        vec!["Measurements", "Tags", "Fields", "Retention Policies"]
    );
    assert_eq!(nodes[0].scope.as_deref(), Some("measurements:telemetry"));
}

#[test]
fn influxdb_show_results_normalize_to_records() {
    let value = json!({
        "results": [{
            "series": [{
                "columns": ["fieldKey", "fieldType"],
                "values": [["usage_user", "float"]]
            }]
        }]
    });
    let records = series_table_records(&value);

    assert_eq!(records[0]["name"], "usage_user");
    assert_eq!(records[0]["type"], "float");
}

#[test]
fn influxdb_retention_label_prefers_default_policy() {
    let label = retention_label(&[
        json!({ "name": "short", "duration": "1h", "default": false }),
        json!({ "name": "autogen", "duration": "0s", "default": true }),
    ]);

    assert_eq!(label, "autogen / 0s");
}

#[test]
fn influxdb_node_ids_map_to_object_views() {
    assert_eq!(influx_object_view("influx:buckets"), "buckets");
    assert_eq!(influx_object_view("bucket:telemetry"), "bucket");
    assert_eq!(
        influx_object_view("measurement:telemetry:cpu"),
        "measurement"
    );
    assert_eq!(influx_object_view("tag:telemetry:host"), "tag");
    assert_eq!(influx_object_view("field:telemetry:value"), "field");
    assert_eq!(
        influx_object_view("retention:telemetry:autogen"),
        "retention-policies"
    );
    assert_eq!(influx_object_view("influx:tasks"), "tasks");
    assert_eq!(influx_object_view("task:rollup"), "task");
    assert_eq!(influx_object_view("influx:security"), "security");
}

#[test]
fn influxdb_diagnostics_are_view_friendly() {
    let diagnostics = diagnostic_records(
        "telemetry",
        InfluxDiagnosticCounts {
            buckets: 1,
            measurements: 2,
            tags: 3,
            fields: 4,
            retention_policies: 1,
            tasks: 1,
            tokens: 1,
        },
    );

    assert_eq!(diagnostics[0]["signal"], "Bucket Visibility");
    assert_eq!(diagnostics[2]["value"], "3 tag(s), 4 field(s)");
    assert_eq!(diagnostics[4]["signal"], "Tasks");
    assert_eq!(diagnostics[5]["signal"], "Authorizations");
}

#[test]
fn influxdb_authorization_scopes_never_include_token_values() {
    let scopes = influx_authorization_scopes(&json!({
        "token": "secret-token",
        "permissions": [
            { "action": "read", "resource": { "type": "buckets" } },
            { "action": "write", "resource": { "type": "tasks" } }
        ]
    }));

    assert_eq!(scopes, "read:buckets, write:tasks");
    assert!(!scopes.contains("secret-token"));
}

fn connection() -> ResolvedConnectionProfile {
    ResolvedConnectionProfile {
        id: "conn-influx".into(),
        name: "InfluxDB".into(),
        engine: "influxdb".into(),
        family: "timeseries".into(),
        host: "localhost".into(),
        port: Some(8086),
        database: Some("telemetry".into()),
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
