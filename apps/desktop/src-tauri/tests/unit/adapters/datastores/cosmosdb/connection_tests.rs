use super::{
    cosmosdb_auth_header, cosmosdb_default_database, cosmosdb_master_key_authorization,
    cosmosdb_post_query, cosmosdb_resource_scope, CosmosDbEndpoint, CosmosDbQueryRequestOptions,
};
use crate::domain::models::{CosmosDbConnectionOptions, ResolvedConnectionProfile};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio_util::sync::CancellationToken;

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

#[tokio::test]
async fn cosmosdb_query_transport_uses_headers_and_preserves_response_metadata() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move {
        let (mut stream, _) = listener.accept().await.unwrap();
        let mut request = Vec::new();
        let mut buffer = [0_u8; 4096];
        loop {
            let read = stream.read(&mut buffer).await.unwrap();
            if read == 0 {
                break;
            }
            request.extend_from_slice(&buffer[..read]);
            let Some(header_end) = request.windows(4).position(|window| window == b"\r\n\r\n")
            else {
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

        let body = r#"{"Documents":[{"id":"1"}],"_count":1}"#;
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nx-ms-request-charge: 3.25\r\nx-ms-continuation: next-token\r\nx-ms-item-count: 1\r\nx-ms-activity-id: activity-42\r\nx-ms-session-token: 0:99\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
        stream.write_all(response.as_bytes()).await.unwrap();
        String::from_utf8(request).unwrap()
    });

    let mut connection = connection(Some(CosmosDbConnectionOptions {
        connect_mode: Some("emulator".into()),
        account_endpoint: Some(format!("http://{address}")),
        auth_mode: Some("emulator".into()),
        max_retry_attempts: Some(0),
        ..CosmosDbConnectionOptions::default()
    }));
    connection.host = address.ip().to_string();
    connection.port = Some(address.port());
    let response = cosmosdb_post_query(
        &connection,
        "/dbs/catalog/colls/orders/docs",
        r#"{"query":"SELECT * FROM c","parameters":[]}"#,
        CosmosDbQueryRequestOptions {
            max_item_count: 25,
            continuation: Some("previous-token".into()),
            partition_key: Some(r#"["tenant-1"]"#.into()),
            session_token: Some("0:41".into()),
            enable_cross_partition: false,
            populate_query_metrics: true,
            populate_index_metrics: true,
        },
        None,
    )
    .await
    .unwrap();
    let request = server.await.unwrap().to_ascii_lowercase();

    assert!(request.starts_with("post /dbs/catalog/colls/orders/docs http/1.1"));
    assert!(request.contains("content-type: application/query+json"));
    assert!(request.contains("x-ms-max-item-count: 25"));
    assert!(request.contains("x-ms-continuation: previous-token"));
    assert!(request.contains("x-ms-session-token: 0:41"));
    assert!(request.contains("x-ms-documentdb-partitionkey: [\"tenant-1\"]"));
    assert!(request.contains("x-ms-documentdb-query-enablecrosspartition: false"));
    assert!(request.contains("x-ms-documentdb-populatequerymetrics: true"));
    assert!(request.contains("x-ms-documentdb-populateindexmetrics: true"));
    assert!(!request.contains("maxitemcount"));
    assert_eq!(response.request_charge, Some(3.25));
    assert_eq!(response.continuation.as_deref(), Some("next-token"));
    assert_eq!(response.item_count, Some(1));
    assert_eq!(response.activity_id.as_deref(), Some("activity-42"));
    assert_eq!(response.session_token.as_deref(), Some("0:99"));
}

#[tokio::test]
async fn cosmosdb_query_transport_stops_before_dispatch_when_cancelled() {
    let mut connection = connection(Some(CosmosDbConnectionOptions {
        account_endpoint: Some("http://127.0.0.1:1".into()),
        auth_mode: Some("emulator".into()),
        max_retry_attempts: Some(0),
        ..CosmosDbConnectionOptions::default()
    }));
    connection.host = "127.0.0.1".into();
    connection.port = Some(1);
    let cancellation = CancellationToken::new();
    cancellation.cancel();

    let error = cosmosdb_post_query(
        &connection,
        "/dbs/catalog/colls/orders/docs",
        r#"{"query":"SELECT * FROM c","parameters":[]}"#,
        CosmosDbQueryRequestOptions {
            max_item_count: 25,
            ..CosmosDbQueryRequestOptions::default()
        },
        Some(&cancellation),
    )
    .await
    .unwrap_err();

    assert_eq!(error.code, "execution-cancelled");
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
