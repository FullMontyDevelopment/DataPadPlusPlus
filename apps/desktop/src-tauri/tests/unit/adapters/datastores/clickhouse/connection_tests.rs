use super::{clickhouse_credentials, clickhouse_query, encode_query_component, ClickHouseEndpoint};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
};

fn clickhouse_connection() -> crate::domain::models::ResolvedConnectionProfile {
    crate::domain::models::ResolvedConnectionProfile {
        id: "conn-clickhouse".into(),
        name: "ClickHouse".into(),
        engine: "clickhouse".into(),
        family: "warehouse".into(),
        host: "ignored".into(),
        port: Some(8123),
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
        graph_options: None,
        warehouse_options: Some(crate::domain::models::WarehouseConnectionOptions {
            endpoint_url: Some("http://localhost:18123/reverse".into()),
            path_prefix: Some("/clickhouse".into()),
            database_name: Some("analytics".into()),
            ..crate::domain::models::WarehouseConnectionOptions::default()
        }),
        read_only: true,
    }
}

#[test]
fn clickhouse_endpoint_prefers_warehouse_options() {
    let connection = clickhouse_connection();

    let endpoint = ClickHouseEndpoint::from_connection(&connection).unwrap();

    assert_eq!(endpoint.host, "localhost");
    assert_eq!(endpoint.scheme, "http");
    assert_eq!(endpoint.port, 18123);
    assert_eq!(endpoint.database, "analytics");
    assert_eq!(
        endpoint.path("/?database=analytics"),
        "/clickhouse/?database=analytics"
    );
}

#[test]
fn clickhouse_database_query_value_is_url_encoded() {
    assert_eq!(
        encode_query_component("analytics qa/2026"),
        "analytics%20qa%2F2026"
    );
}

#[test]
fn clickhouse_credentials_reject_newline_in_credentials() {
    let mut connection = clickhouse_connection();
    connection.username = Some("user\r\nX-Bad: injected".into());

    let error = clickhouse_credentials(&connection).unwrap_err();

    assert_eq!(error.code, "clickhouse-invalid-header");
}

#[test]
fn clickhouse_endpoint_rejects_invalid_http_parts() {
    let https_endpoint =
        ClickHouseEndpoint::from_url("https://localhost:8443", None, None).unwrap();
    assert_eq!(https_endpoint.scheme, "https");
    assert_eq!(https_endpoint.port, 8443);

    let scheme_error =
        ClickHouseEndpoint::from_url("clickhouse://localhost:9000", None, None).unwrap_err();
    assert_eq!(scheme_error.code, "clickhouse-unsupported-url");

    let host_error =
        ClickHouseEndpoint::from_url("http://local\r\nhost:8123/clickhouse", None, None)
            .unwrap_err();
    assert_eq!(host_error.code, "clickhouse-endpoint-invalid");

    let authority_error =
        ClickHouseEndpoint::from_url("http://localhost:8123?x=1", None, None).unwrap_err();
    assert_eq!(authority_error.code, "clickhouse-endpoint-invalid");

    let prefix_error =
        ClickHouseEndpoint::from_url("http://localhost:8123/clickhouse?x=1", None, None)
            .unwrap_err();
    assert_eq!(prefix_error.code, "clickhouse-endpoint-invalid");

    let override_error =
        ClickHouseEndpoint::from_url("http://localhost:8123/clickhouse", None, Some("bad#x"))
            .unwrap_err();
    assert_eq!(override_error.code, "clickhouse-endpoint-invalid");
}

#[tokio::test]
async fn clickhouse_query_decodes_chunked_http_responses() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let mut request = vec![0_u8; 4096];
        let bytes_read = socket.read(&mut request).await.unwrap();
        assert!(String::from_utf8_lossy(&request[..bytes_read]).contains("SELECT 1 FORMAT JSON"));

        let chunks = [
            "{\"meta\":[{\"name\":\"value\",\"type\":\"UInt8\"}],",
            "\"data\":[{\"value\":1}],\"rows\":1}",
        ];
        socket
            .write_all(
                b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n",
            )
            .await
            .unwrap();
        for chunk in chunks {
            socket
                .write_all(format!("{:X}\r\n{chunk}\r\n", chunk.len()).as_bytes())
                .await
                .unwrap();
        }
        socket.write_all(b"0\r\n\r\n").await.unwrap();
    });

    let mut connection = clickhouse_connection();
    connection.warehouse_options.as_mut().unwrap().endpoint_url = Some(format!("http://{address}"));

    let body = clickhouse_query(&connection, "SELECT 1 FORMAT JSON")
        .await
        .unwrap();

    server.await.unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert_eq!(parsed["data"][0]["value"], 1);

    let payloads =
        crate::adapters::datastores::clickhouse::payloads::clickhouse_json_payloads_bounded(
            &body, None,
        )
        .payloads;
    assert_eq!(payloads[0]["renderer"], "table");
    assert_eq!(payloads[1]["renderer"], "json");
    assert_eq!(payloads[2]["renderer"], "raw");
}
