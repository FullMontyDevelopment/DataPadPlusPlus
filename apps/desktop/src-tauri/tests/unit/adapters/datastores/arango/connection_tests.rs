use super::ArangoEndpoint;
use crate::domain::models::ResolvedConnectionProfile;

#[test]
fn arango_endpoint_parses_database_from_url() {
    let endpoint = ArangoEndpoint::from_url("http://localhost:8529/_db/app", None).unwrap();
    assert_eq!(endpoint.host, "localhost");
    assert_eq!(endpoint.port, 8529);
    assert_eq!(endpoint.path("/_api/version"), "/_db/app/_api/version");
}

#[test]
fn arango_endpoint_prefers_graph_options() {
    let connection = ResolvedConnectionProfile {
        id: "conn-arango".into(),
        name: "ArangoDB".into(),
        engine: "arango".into(),
        family: "graph".into(),
        host: "ignored".into(),
        port: Some(8529),
        database: Some("_system".into()),
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
            endpoint_url: Some("http://localhost:18529".into()),
            database_name: Some("fraud".into()),
            ..crate::domain::models::GraphConnectionOptions::default()
        }),
        warehouse_options: None,
        read_only: true,
    };

    let endpoint = ArangoEndpoint::from_connection(&connection).unwrap();

    assert_eq!(endpoint.host, "localhost");
    assert_eq!(endpoint.port, 18529);
    assert_eq!(endpoint.path("/_api/version"), "/_db/fraud/_api/version");
}

#[test]
fn arango_endpoint_rejects_control_characters_and_path_database() {
    let host_error = ArangoEndpoint::from_url("http://local\nhost:8529/_db/app", None).unwrap_err();
    assert_eq!(host_error.code, "arango-endpoint-invalid");

    let database_error =
        ArangoEndpoint::from_url("http://localhost:8529/_db/app", Some("bad/db")).unwrap_err();
    assert_eq!(database_error.code, "arango-endpoint-invalid");
}
