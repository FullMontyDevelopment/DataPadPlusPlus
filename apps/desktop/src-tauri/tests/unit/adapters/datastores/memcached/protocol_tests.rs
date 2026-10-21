use super::*;
use crate::domain::models::MemcachedConnectionOptions;

#[test]
fn memcached_address_prefers_first_configured_server() {
    let connection = connection(Some(MemcachedConnectionOptions {
        servers: vec![
            " ".into(),
            "cache-a.internal:11212".into(),
            "cache-b:11211".into(),
        ],
        ..MemcachedConnectionOptions::default()
    }));

    assert_eq!(memcached_address(&connection), "cache-a.internal:11212");
}

#[test]
fn memcached_address_falls_back_to_profile_host_and_port() {
    let connection = connection(None);

    assert_eq!(memcached_address(&connection), "localhost:11212");
}

#[test]
fn memcached_address_uses_default_port_when_profile_port_is_empty() {
    let mut connection = connection(None);
    connection.port = None;

    assert_eq!(memcached_address(&connection), "localhost:11211");
}

#[test]
fn memcached_value_parser_preserves_multiline_and_binary_values() {
    let response =
        b"VALUE json 0 15\r\n{\"line\":\"a\\nb\"}\r\nVALUE binary 7 4 42\r\n\0\xff\r\n\r\nEND\r\n";
    let values = parse_memcached_values(response).expect("valid value response");

    assert_eq!(values.len(), 2);
    assert_eq!(values[0].key, "json");
    assert_eq!(values[0].value, b"{\"line\":\"a\\nb\"}");
    assert_eq!(values[1].cas.as_deref(), Some("42"));
    assert_eq!(values[1].value, b"\0\xff\r\n");
}

#[test]
fn memcached_value_parser_rejects_incomplete_payloads() {
    let error = parse_memcached_values(b"VALUE large 0 20\r\ntoo short")
        .expect_err("truncated values must fail");

    assert_eq!(error.code, "memcached-response-incomplete");
}

#[tokio::test]
async fn export_stream_preserves_binary_values_flags_and_full_multiline_text() {
    let (result, rows) = run_export_response(
        b"VALUE json 0 15 41\r\n{\"line\":\"a\\nb\"}\r\nVALUE binary 7 4 42\r\n\0\xff\r\n\r\nEND\r\n",
        "gets json binary", None,
    ).await;
    result.unwrap();
    assert_eq!(
        rows,
        vec![
            json!({"key": "json", "value": "{\"line\":\"a\\nb\"}", "flags": "0", "cas": "41"}),
            json!({"key": "binary", "value": [0,255,13,10], "flags": "7", "cas": "42"}),
        ]
    );
}

#[tokio::test]
async fn export_stream_requires_the_end_marker_and_rejects_wrong_keys_or_lengths() {
    for response in [
        b"VALUE json 0 3\r\nabc\r\n".as_slice(),
        b"VALUE json 0 9\r\nabc\r\nEND\r\n",
        b"VALUE other 0 3\r\nabc\r\nEND\r\n",
        b"SERVER_ERROR sensitive details\r\n",
        b"VALUE json 0 3\r\nabcXXEND\r\n",
    ] {
        let (result, _) = run_export_response(response, "get json", None).await;
        let error = result.unwrap_err();
        assert_eq!(error.code, "memcached-stream-incomplete");
        assert!(!error.message.contains("sensitive details"));
    }
}

#[tokio::test]
async fn export_stream_can_stop_without_waiting_for_the_remaining_response() {
    let (result, rows) = run_export_response(
        b"VALUE first 0 1\r\n1\r\nVALUE second 0 1\r\n2\r\nEND\r\n",
        "get first second",
        Some(1),
    )
    .await;
    result.unwrap();
    assert_eq!(rows.len(), 1);
}

async fn run_export_response(
    response: &[u8],
    query: &str,
    stop: Option<usize>,
) -> (Result<(), CommandError>, Vec<Value>) {
    use crate::adapters::result_stream::ResultRowSink;
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let response = response.to_vec();
    let server = tokio::spawn(async move {
        let (socket, _) = listener.accept().await.unwrap();
        let mut socket = BufReader::new(socket);
        let mut line = String::new();
        socket.read_line(&mut line).await.unwrap();
        socket.get_mut().write_all(&response).await.unwrap();
    });
    let profile = ResolvedConnectionProfile {
        host: "127.0.0.1".into(),
        port: Some(port),
        ..connection(None)
    };
    let request = serde_json::from_value(json!({
        "tabId": "fixture", "connectionId": profile.id, "environmentId": "test",
        "queryText": query, "language": "text"
    }))
    .unwrap();
    struct Sink {
        rows: Vec<Value>,
        stop: Option<usize>,
    }
    impl ResultRowSink for Sink {
        fn row(&mut self, row: Value) -> Result<bool, CommandError> {
            self.rows.push(row);
            Ok(self.stop.is_none_or(|limit| self.rows.len() < limit))
        }
    }
    let mut sink = Sink {
        rows: Vec::new(),
        stop,
    };
    let result = stream_result(&profile, &request, &mut sink).await;
    server.await.unwrap();
    (result, sink.rows)
}

#[tokio::test]
async fn export_stream_rejects_unsafe_or_unsupported_commands_before_connecting() {
    use crate::adapters::result_stream::ResultRowSink;
    struct NoRows;
    impl ResultRowSink for NoRows {
        fn row(&mut self, _: Value) -> Result<bool, CommandError> {
            panic!("no connection expected")
        }
    }
    for query in ["stats", "get", "set key 0 0 1\r\nx", "get key\r\nflush_all"] {
        let request = serde_json::from_value(json!({
            "tabId": "fixture", "connectionId": "fixture", "environmentId": "test",
            "queryText": query, "language": "text"
        }))
        .unwrap();
        assert_eq!(
            stream_result(&connection(None), &request, &mut NoRows)
                .await
                .unwrap_err()
                .code,
            "result-export-unsupported"
        );
    }
}

fn connection(memcached_options: Option<MemcachedConnectionOptions>) -> ResolvedConnectionProfile {
    ResolvedConnectionProfile {
        id: "conn-memcached".into(),
        name: "Memcached".into(),
        engine: "memcached".into(),
        family: "keyvalue".into(),
        host: "localhost".into(),
        port: Some(11212),
        database: None,
        username: None,
        password: None,
        connection_string: None,
        redis_options: None,
        memcached_options,
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
        mongodb_options: None,
        warehouse_options: None,
        read_only: false,
    }
}
