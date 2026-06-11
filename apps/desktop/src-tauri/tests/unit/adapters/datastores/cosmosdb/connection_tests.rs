use super::{cosmosdb_auth_header, cosmosdb_default_database, CosmosDbEndpoint};
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
fn cosmosdb_auth_header_rejects_newline_in_authorization_value() {
    let mut connection = connection(None);
    connection.password = Some("type=master\r\nX-Bad: injected".into());

    let error = cosmosdb_auth_header(&connection).unwrap_err();

    assert_eq!(error.code, "cosmosdb-invalid-auth-header");
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
        warehouse_options: None,
        read_only: true,
    }
}
