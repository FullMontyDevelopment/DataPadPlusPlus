use super::{neptune_gremlin_body, percent_encode_form, NeptuneEndpoint};

#[test]
fn neptune_endpoint_parses_prefixed_http_url() {
    let endpoint = NeptuneEndpoint::from_url("http://localhost:18182/neptune").unwrap();
    assert_eq!(endpoint.host, "localhost");
    assert_eq!(endpoint.port, 18182);
    assert_eq!(endpoint.path("/status"), "/neptune/status");
}

#[test]
fn neptune_gremlin_body_contains_script() {
    let body = neptune_gremlin_body("g.V().limit(1)");
    let value: serde_json::Value = serde_json::from_str(&body).unwrap();

    assert_eq!(value["gremlin"], "g.V().limit(1)");
}

#[test]
fn neptune_form_encoding_uses_plus_for_spaces() {
    assert_eq!(
        percent_encode_form("MATCH (n) RETURN n"),
        "MATCH+%28n%29+RETURN+n"
    );
}

#[test]
fn neptune_endpoint_prefers_graph_options() {
    let connection = crate::domain::models::ResolvedConnectionProfile {
        id: "conn-neptune".into(),
        name: "Neptune".into(),
        engine: "neptune".into(),
        family: "graph".into(),
        host: "ignored".into(),
        port: Some(8182),
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
        graph_options: Some(crate::domain::models::GraphConnectionOptions {
            endpoint_url: Some("http://localhost:18182/proxy".into()),
            path_prefix: Some("/neptune".into()),
            ..crate::domain::models::GraphConnectionOptions::default()
        }),
        warehouse_options: None,
        read_only: true,
    };

    let endpoint = NeptuneEndpoint::from_connection(&connection).unwrap();

    assert_eq!(endpoint.host, "localhost");
    assert_eq!(endpoint.port, 18182);
    assert_eq!(endpoint.path("/status"), "/neptune/status");
}

#[test]
fn neptune_endpoint_rejects_invalid_http_parts() {
    let host_error = NeptuneEndpoint::from_url("http://local\nhost:18182/neptune").unwrap_err();
    assert_eq!(host_error.code, "neptune-endpoint-invalid");

    let prefix_error =
        NeptuneEndpoint::from_url_with_prefix("http://localhost:18182/neptune?x=1", None)
            .unwrap_err();
    assert_eq!(prefix_error.code, "neptune-endpoint-invalid");

    let override_error =
        NeptuneEndpoint::from_url_with_prefix("http://localhost:18182/neptune", Some("bad#x"))
            .unwrap_err();
    assert_eq!(override_error.code, "neptune-endpoint-invalid");
}
