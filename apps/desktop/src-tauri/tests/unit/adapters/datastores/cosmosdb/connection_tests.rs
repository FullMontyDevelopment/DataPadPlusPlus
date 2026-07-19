use super::{
    cosmosdb_auth_header, cosmosdb_default_database, cosmosdb_master_key_authorization,
    cosmosdb_resource_scope, CosmosDbEndpoint,
};
use crate::domain::models::{CosmosDbConnectionOptions, ResolvedConnectionProfile};

#[test]
fn cosmosdb_endpoint_parses_prefixed_http_url() {
    let endpoint = CosmosDbEndpoint::from_url("http://localhost:18081/cosmos").unwrap();
    assert_eq!(endpoint.host, "localhost");
    assert_eq!(endpoint.port, 18081);
    assert_eq!(endpoint.path("/dbs"), "/cosmos/dbs");
}

#[test]
fn cosmosdb_endpoint_prefers_typed_account_endpoint() {
    let connection = connection(Some(CosmosDbConnectionOptions {
        account_endpoint: Some("http://localhost:18081/cosmos".into()),
        database_name: Some("catalog".into()),
        ..CosmosDbConnectionOptions::default()
    }));

    let endpoint = CosmosDbEndpoint::from_connection(&connection).unwrap();

    assert_eq!(endpoint.host, "localhost");
    assert_eq!(endpoint.port, 18081);
    assert_eq!(endpoint.path("/dbs"), "/cosmos/dbs");
    assert_eq!(cosmosdb_default_database(&connection), "catalog");
}

#[test]
fn cosmosdb_emulator_endpoint_defaults_bare_localhost_to_gateway_port() {
    let connection = connection(Some(CosmosDbConnectionOptions {
        connect_mode: Some("emulator".into()),
        account_endpoint: Some("localhost".into()),
        auth_mode: Some("emulator".into()),
        ..CosmosDbConnectionOptions::default()
    }));

    let endpoint = CosmosDbEndpoint::from_connection(&connection).unwrap();

    assert_eq!(endpoint.host, "localhost");
    assert_eq!(endpoint.port, 8081);
    assert_eq!(endpoint.path("/dbs"), "/dbs");
}

#[test]
fn cosmosdb_emulator_endpoint_parses_bare_localhost_port() {
    let connection = connection(Some(CosmosDbConnectionOptions {
        connect_mode: Some("emulator".into()),
        account_endpoint: Some("localhost:8082".into()),
        auth_mode: Some("emulator".into()),
        ..CosmosDbConnectionOptions::default()
    }));

    let endpoint = CosmosDbEndpoint::from_connection(&connection).unwrap();

    assert_eq!(endpoint.host, "localhost");
    assert_eq!(endpoint.port, 8082);
}

#[test]
fn cosmosdb_emulator_endpoint_preserves_explicit_http_endpoint() {
    let connection = connection(Some(CosmosDbConnectionOptions {
        connect_mode: Some("emulator".into()),
        account_endpoint: Some("http://localhost:8081".into()),
        auth_mode: Some("emulator".into()),
        ..CosmosDbConnectionOptions::default()
    }));

    let endpoint = CosmosDbEndpoint::from_connection(&connection).unwrap();

    assert_eq!(endpoint.host, "localhost");
    assert_eq!(endpoint.port, 8081);
    assert_eq!(endpoint.display_url(), "http://localhost:8081");
}

#[test]
fn cosmosdb_auth_header_rejects_newline_in_authorization_value() {
    let mut connection = connection(None);
    connection.password = Some("type=master\r\nX-Bad: injected".into());
    let endpoint = CosmosDbEndpoint::from_connection(&connection).unwrap();

    let error = cosmosdb_auth_header(
        &connection,
        "GET",
        "/dbs",
        "Thu, 27 Apr 2017 00:51:12 GMT",
        &endpoint,
    )
    .unwrap_err();

    assert_eq!(error.code, "cosmosdb-invalid-auth-header");
}

#[test]
fn cosmosdb_master_key_signing_is_deterministic_and_url_encoded() {
    let token = cosmosdb_master_key_authorization(
        "GET",
        "dbs",
        "",
        "Thu, 27 Apr 2017 00:51:12 GMT",
        "C2y6yDjf5/R+ob0N8A7Cgv30VRDJIWEHLM+4QDU5DE2nQ9nDuVTqobD4b8mGGyPMbIZnqyMsEcaGQy67XIw/Jw==",
    )
    .unwrap();

    assert_eq!(
        token,
        "type%3Dmaster%26ver%3D1.0%26sig%3DBk4MqbjRdQImb4Rqp5pmqv1%2FOhkMQU93qlTmk%2FSzVRQ%3D"
    );
}

#[test]
fn cosmosdb_resource_scope_uses_parent_for_collection_requests() {
    assert_eq!(
        cosmosdb_resource_scope("GET", "/dbs").unwrap(),
        ("dbs".into(), "".into())
    );
    assert_eq!(
        cosmosdb_resource_scope("GET", "/dbs/datapadplusplus/colls").unwrap(),
        ("colls".into(), "dbs/datapadplusplus".into())
    );
    assert_eq!(
        cosmosdb_resource_scope("POST", "/dbs/datapadplusplus/colls/orders/docs").unwrap(),
        ("docs".into(), "dbs/datapadplusplus/colls/orders".into())
    );
}

#[test]
fn cosmosdb_emulator_auth_uses_well_known_key_for_local_endpoint() {
    let connection = connection(Some(CosmosDbConnectionOptions {
        connect_mode: Some("emulator".into()),
        account_endpoint: Some("http://localhost:8081".into()),
        auth_mode: Some("emulator".into()),
        ..CosmosDbConnectionOptions::default()
    }));
    let endpoint = CosmosDbEndpoint::from_connection(&connection).unwrap();

    let header = cosmosdb_auth_header(
        &connection,
        "GET",
        "/dbs",
        "Thu, 27 Apr 2017 00:51:12 GMT",
        &endpoint,
    )
    .unwrap();

    assert_eq!(
        header,
        "Authorization: type%3Dmaster%26ver%3D1.0%26sig%3DBk4MqbjRdQImb4Rqp5pmqv1%2FOhkMQU93qlTmk%2FSzVRQ%3D\r\n"
    );
}

fn connection(cosmos_db_options: Option<CosmosDbConnectionOptions>) -> ResolvedConnectionProfile {
    ResolvedConnectionProfile {
        id: "conn-cosmos".into(),
        name: "Cosmos DB".into(),
        engine: "cosmosdb".into(),
        family: "document".into(),
        host: "localhost".into(),
        port: Some(8081),
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
        cosmos_db_options,
        search_options: None,
        time_series_options: None,
        graph_options: None,
        mongodb_options: None,
        warehouse_options: None,
        read_only: true,
    }
}
