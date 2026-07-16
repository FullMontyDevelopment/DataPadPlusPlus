use super::{influxdb_authorization, influxdb_get, influxdb_query_path, InfluxDbEndpoint};
use crate::domain::models::ResolvedConnectionProfile;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
};

#[test]
fn influxdb_endpoint_parses_prefixed_url_and_database_override() {
    let endpoint =
        InfluxDbEndpoint::from_url("http://localhost:18086/influx", Some("metrics")).unwrap();
    assert_eq!(endpoint.host, "localhost");
    assert_eq!(endpoint.port, 18086);
    assert_eq!(endpoint.database, "metrics");
    assert_eq!(endpoint.path("/ping"), "/influx/ping");
}

#[test]
fn influxdb_endpoint_uses_profile_defaults() {
    let connection = ResolvedConnectionProfile {
        id: "conn-influx".into(),
        name: "InfluxDB".into(),
        engine: "influxdb".into(),
        family: "timeseries".into(),
        host: "127.0.0.1".into(),
        port: None,
        database: Some("telegraf".into()),
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
    let endpoint = InfluxDbEndpoint::from_connection(&connection).unwrap();
    assert_eq!(endpoint.port, 8086);
    assert_eq!(endpoint.database, "telegraf");
}

#[test]
fn influxdb_endpoint_prefers_timeseries_endpoint_bucket_and_prefix() {
    let connection = ResolvedConnectionProfile {
        id: "conn-influx".into(),
        name: "InfluxDB".into(),
        engine: "influxdb".into(),
        family: "timeseries".into(),
        host: "ignored".into(),
        port: Some(8086),
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
            endpoint_url: Some("http://localhost:18086/proxy".into()),
            path_prefix: Some("/influx".into()),
            bucket: Some("telemetry".into()),
            ..crate::domain::models::TimeSeriesConnectionOptions::default()
        }),
        graph_options: None,
        warehouse_options: None,
        read_only: true,
    };

    let endpoint = InfluxDbEndpoint::from_connection(&connection).unwrap();

    assert_eq!(endpoint.host, "localhost");
    assert_eq!(endpoint.port, 18086);
    assert_eq!(endpoint.database, "telemetry");
    assert_eq!(endpoint.path("/ping"), "/influx/ping");
}

#[test]
fn influxdb_query_path_encodes_database_and_influxql() {
    assert_eq!(
        influxdb_query_path("app metrics", "SELECT * FROM \"cpu load\" LIMIT 10"),
        "/query?db=app+metrics&q=SELECT+%2A+FROM+%22cpu+load%22+LIMIT+10"
    );
}

#[test]
fn influxdb_endpoint_rejects_control_characters() {
    let mut connection = ResolvedConnectionProfile {
        id: "conn-influx".into(),
        name: "InfluxDB".into(),
        engine: "influxdb".into(),
        family: "timeseries".into(),
        host: "127.0.0.1\r\nX-Bad: yes".into(),
        port: None,
        database: Some("telegraf".into()),
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
    let host_error = InfluxDbEndpoint::from_connection(&connection).unwrap_err();
    assert_eq!(host_error.code, "influxdb-endpoint-invalid");

    connection.host = "127.0.0.1".into();
    connection.database = Some("telegraf\r\nX-Bad: yes".into());
    let database_error = InfluxDbEndpoint::from_connection(&connection).unwrap_err();
    assert_eq!(database_error.code, "influxdb-endpoint-invalid");
}

#[test]
fn influxdb_token_auth_rejects_control_characters() {
    let connection = ResolvedConnectionProfile {
        id: "conn-influx".into(),
        name: "InfluxDB".into(),
        engine: "influxdb".into(),
        family: "timeseries".into(),
        host: "127.0.0.1".into(),
        port: None,
        database: Some("telegraf".into()),
        username: None,
        password: Some("token\r\nX-Bad: yes".into()),
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

    let error = influxdb_authorization(&connection).unwrap_err();

    assert_eq!(error.code, "influxdb-endpoint-invalid");
}

#[tokio::test]
async fn influxdb_get_decodes_chunked_json_for_result_normalization() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let mut request = vec![0_u8; 4096];
        let bytes_read = socket.read(&mut request).await.unwrap();
        assert!(String::from_utf8_lossy(&request[..bytes_read]).contains("GET /query?db=metrics"));

        let chunks = [
            "{\"results\":[{\"statement_id\":0,\"series\":[{\"name\":\"cpu\",",
            "\"columns\":[\"time\",\"value\"],\"values\":[[\"2026-01-01T00:00:00Z\",42]]}]}]}",
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

    let connection = ResolvedConnectionProfile {
        id: "conn-influx-chunked".into(),
        name: "InfluxDB chunked".into(),
        engine: "influxdb".into(),
        family: "timeseries".into(),
        host: address.ip().to_string(),
        port: Some(address.port()),
        database: Some("metrics".into()),
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
    let response = influxdb_get(&connection, "/query?db=metrics&q=SELECT+value+FROM+cpu")
        .await
        .unwrap();

    server.await.unwrap();
    let value =
        crate::adapters::datastores::influxdb::query::parse_influxdb_json(&response.body).unwrap();
    let normalized =
        crate::adapters::datastores::influxdb::query_results::normalize_influxdb_query_result(
            &value, 100,
        );
    assert_eq!(
        normalized.columns,
        vec!["measurement", "tags", "time", "value"]
    );
    assert_eq!(normalized.rows[0][3], "42");
}
