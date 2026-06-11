use super::{neo4j_commit_path, neo4j_statement_body, Neo4jEndpoint};
use crate::domain::models::ResolvedConnectionProfile;

#[test]
fn neo4j_endpoint_parses_database_url() {
    let endpoint = Neo4jEndpoint::from_url("http://localhost:17474/db/app", None).unwrap();
    assert_eq!(endpoint.host, "localhost");
    assert_eq!(endpoint.port, 17474);
    assert_eq!(endpoint.database, "app");
    assert_eq!(endpoint.path("/db/app/tx/commit"), "/db/app/tx/commit");
}

#[test]
fn neo4j_commit_path_uses_profile_database() {
    let connection = ResolvedConnectionProfile {
        id: "conn-neo4j".into(),
        name: "Neo4j".into(),
        engine: "neo4j".into(),
        family: "graph".into(),
        host: "127.0.0.1".into(),
        port: None,
        database: Some("analytics".into()),
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

    assert_eq!(
        neo4j_commit_path(&connection).unwrap(),
        "/db/analytics/tx/commit"
    );
}

#[test]
fn neo4j_endpoint_prefers_graph_options() {
    let connection = ResolvedConnectionProfile {
        id: "conn-neo4j".into(),
        name: "Neo4j".into(),
        engine: "neo4j".into(),
        family: "graph".into(),
        host: "ignored".into(),
        port: Some(7474),
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
            endpoint_url: Some("http://localhost:17474/proxy".into()),
            path_prefix: Some("/neo4j".into()),
            database_name: Some("analytics".into()),
            ..crate::domain::models::GraphConnectionOptions::default()
        }),
        warehouse_options: None,
        read_only: true,
    };

    let endpoint = Neo4jEndpoint::from_connection(&connection).unwrap();

    assert_eq!(endpoint.host, "localhost");
    assert_eq!(endpoint.port, 17474);
    assert_eq!(endpoint.database, "analytics");
    assert_eq!(
        endpoint.path("/db/analytics/tx/commit"),
        "/neo4j/db/analytics/tx/commit"
    );
}

#[test]
fn neo4j_statement_body_requests_row_and_graph_results() {
    let body = neo4j_statement_body("MATCH (n) RETURN n LIMIT 1");
    let value: serde_json::Value = serde_json::from_str(&body).unwrap();

    assert_eq!(
        value["statements"][0]["statement"],
        "MATCH (n) RETURN n LIMIT 1"
    );
    assert_eq!(value["statements"][0]["resultDataContents"][0], "row");
    assert_eq!(value["statements"][0]["resultDataContents"][1], "graph");
}

#[test]
fn neo4j_endpoint_rejects_control_characters_and_path_in_database() {
    let mut connection = ResolvedConnectionProfile {
        id: "conn-neo4j".into(),
        name: "Neo4j".into(),
        engine: "neo4j".into(),
        family: "graph".into(),
        host: "127.0.0.1\r\nX-Bad: yes".into(),
        port: None,
        database: Some("neo4j".into()),
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
    let host_error = Neo4jEndpoint::from_connection(&connection).unwrap_err();
    assert_eq!(host_error.code, "neo4j-endpoint-invalid");

    connection.host = "127.0.0.1".into();
    connection.database = Some("neo4j/tx".into());
    let database_error = Neo4jEndpoint::from_connection(&connection).unwrap_err();
    assert_eq!(database_error.code, "neo4j-endpoint-invalid");
}
