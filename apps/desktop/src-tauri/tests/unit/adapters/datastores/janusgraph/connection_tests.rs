use super::{
    janusgraph_gremlin_body, janusgraph_run_gremlin, janusgraph_websocket_error, JanusGraphEndpoint,
};
use crate::domain::{
    error::CommandError,
    models::{GraphConnectionOptions, ResolvedConnectionProfile},
};

#[test]
fn janusgraph_endpoint_parses_prefixed_url() {
    let endpoint = JanusGraphEndpoint::from_url("http://localhost:18182/janus", Some("g")).unwrap();
    assert_eq!(endpoint.host, "localhost");
    assert_eq!(endpoint.port, 18182);
    assert_eq!(endpoint.path("/gremlin"), "/janus/gremlin");
}

#[test]
fn janusgraph_body_maps_g_alias_to_traversal_source() {
    let connection = ResolvedConnectionProfile {
        id: "conn-janus".into(),
        name: "JanusGraph".into(),
        engine: "janusgraph".into(),
        family: "graph".into(),
        host: "127.0.0.1".into(),
        port: None,
        database: Some("graphTraversal".into()),
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
    let body = janusgraph_gremlin_body(&connection, "g.V().limit(1)").unwrap();
    let value: serde_json::Value = serde_json::from_str(&body).unwrap();

    assert_eq!(value["gremlin"], "g.V().limit(1)");
    assert_eq!(value["aliases"]["g"], "graphTraversal");
}

#[test]
fn janusgraph_endpoint_prefers_graph_options() {
    let connection = ResolvedConnectionProfile {
        id: "conn-janus".into(),
        name: "JanusGraph".into(),
        engine: "janusgraph".into(),
        family: "graph".into(),
        host: "ignored".into(),
        port: Some(8182),
        database: Some("fallback".into()),
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
        graph_options: Some(crate::domain::models::GraphConnectionOptions {
            endpoint_url: Some("http://localhost:18182/proxy".into()),
            path_prefix: Some("/janus".into()),
            traversal_source: Some("analyticsTraversal".into()),
            ..crate::domain::models::GraphConnectionOptions::default()
        }),
        warehouse_options: None,
        read_only: true,
    };

    let body = janusgraph_gremlin_body(&connection, "g.V().limit(1)").unwrap();
    let value: serde_json::Value = serde_json::from_str(&body).unwrap();
    let endpoint = JanusGraphEndpoint::from_connection(&connection).unwrap();

    assert_eq!(endpoint.host, "localhost");
    assert_eq!(endpoint.port, 18182);
    assert_eq!(endpoint.path("/gremlin"), "/janus/gremlin");
    assert_eq!(value["aliases"]["g"], "analyticsTraversal");
}

#[test]
fn janusgraph_endpoint_rejects_invalid_http_parts() {
    let host_error =
        JanusGraphEndpoint::from_url("http://local\r\nhost:18182/janus", Some("g")).unwrap_err();
    assert_eq!(host_error.code, "janusgraph-endpoint-invalid");

    let prefix_error = JanusGraphEndpoint::from_url_with_prefix(
        "http://localhost:18182/janus?x=1",
        Some("g"),
        None,
    )
    .unwrap_err();
    assert_eq!(prefix_error.code, "janusgraph-endpoint-invalid");

    let source_error =
        JanusGraphEndpoint::from_url("http://localhost:18182/janus", Some("bad/source"))
            .unwrap_err();
    assert_eq!(source_error.code, "janusgraph-endpoint-invalid");
}

#[test]
fn janusgraph_fixture_connection_error_is_actionable() {
    let error = janusgraph_websocket_error(
        "ws://127.0.0.1:8183/gremlin",
        CommandError::new(
            "gremlin-connect-failed",
            "The target machine actively refused the connection.",
        ),
    );

    assert_eq!(error.code, "janusgraph-connect-failed");
    assert!(error.message.contains("ws://127.0.0.1:8183/gremlin"));
    assert!(error
        .message
        .contains("npm run fixtures:up:profile -- graph"));
}

#[tokio::test]
async fn janusgraph_websocket_fixture_answers_query() {
    if std::env::var("DATAPADPLUSPLUS_FIXTURE_RUN").unwrap_or_default() != "1" {
        return;
    }
    let port = std::env::var("DATAPADPLUSPLUS_JANUSGRAPH_PORT")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(8183);
    let connection = ResolvedConnectionProfile {
        id: "fixture-janusgraph".into(),
        name: "Fixture JanusGraph".into(),
        engine: "janusgraph".into(),
        family: "graph".into(),
        host: "127.0.0.1".into(),
        port: Some(port),
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
        graph_options: Some(GraphConnectionOptions {
            connect_mode: Some("gremlin-websocket".into()),
            traversal_source: Some("g".into()),
            ..GraphConnectionOptions::default()
        }),
        warehouse_options: None,
        read_only: true,
    };

    let value = janusgraph_run_gremlin(&connection, "g.V().limit(1).count()")
        .await
        .expect("fixture Gremlin WebSocket query");

    assert_eq!(value["status"]["code"], 200);
    assert!(value["result"]["data"].is_array());
}
