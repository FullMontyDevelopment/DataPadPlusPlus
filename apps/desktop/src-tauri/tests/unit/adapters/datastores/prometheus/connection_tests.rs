use super::{percent_encode_query, PrometheusEndpoint};
use crate::domain::models::ResolvedConnectionProfile;

#[test]
fn prometheus_endpoint_parses_http_url_with_prefix() {
    let endpoint = PrometheusEndpoint::from_url("http://localhost:19090/prometheus").unwrap();
    assert_eq!(endpoint.host, "localhost");
    assert_eq!(endpoint.port, 19090);
    assert_eq!(endpoint.path("/api/v1/query"), "/prometheus/api/v1/query");
}

#[test]
fn prometheus_endpoint_uses_host_profile_defaults() {
    let connection = ResolvedConnectionProfile {
        id: "conn-prom".into(),
        name: "Prometheus".into(),
        engine: "prometheus".into(),
        family: "timeseries".into(),
        host: "127.0.0.1".into(),
        port: None,
        database: Some("/metrics".into()),
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
    };
    let endpoint = PrometheusEndpoint::from_connection(&connection).unwrap();
    assert_eq!(endpoint.port, 9090);
    assert_eq!(endpoint.path("/api/v1/labels"), "/metrics/api/v1/labels");
}

#[test]
fn prometheus_endpoint_prefers_timeseries_endpoint_and_prefix() {
    let connection = ResolvedConnectionProfile {
        id: "conn-prom".into(),
        name: "Prometheus".into(),
        engine: "prometheus".into(),
        family: "timeseries".into(),
        host: "ignored".into(),
        port: Some(9090),
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
        time_series_options: Some(crate::domain::models::TimeSeriesConnectionOptions {
            endpoint_url: Some("http://localhost:19090/reverse".into()),
            path_prefix: Some("/prometheus".into()),
            ..crate::domain::models::TimeSeriesConnectionOptions::default()
        }),
        graph_options: None,
        warehouse_options: None,
        read_only: true,
    };

    let endpoint = PrometheusEndpoint::from_connection(&connection).unwrap();

    assert_eq!(endpoint.host, "localhost");
    assert_eq!(endpoint.port, 19090);
    assert_eq!(endpoint.path("/api/v1/query"), "/prometheus/api/v1/query");
}

#[test]
fn prometheus_query_encoding_preserves_promql_symbols() {
    assert_eq!(
        percent_encode_query("rate(http_requests_total[5m]) > 1"),
        "rate%28http_requests_total%5B5m%5D%29+%3E+1"
    );
}

#[test]
fn prometheus_endpoint_rejects_control_characters() {
    let mut connection = ResolvedConnectionProfile {
        id: "conn-prom".into(),
        name: "Prometheus".into(),
        engine: "prometheus".into(),
        family: "timeseries".into(),
        host: "127.0.0.1\r\nX-Bad: yes".into(),
        port: None,
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
        warehouse_options: None,
        read_only: true,
    };
    let host_error = PrometheusEndpoint::from_connection(&connection).unwrap_err();
    assert_eq!(host_error.code, "prometheus-endpoint-invalid");

    connection.host = "127.0.0.1".into();
    connection.database = Some("/metrics\r\nX-Bad: yes".into());
    let path_error = PrometheusEndpoint::from_connection(&connection).unwrap_err();
    assert_eq!(path_error.code, "prometheus-endpoint-invalid");
}
