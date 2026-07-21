use super::*;
use crate::domain::models::{
    CosmosDbConnectionOptions, ResolvedConnectionProfile, ResultPageRequest,
};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

fn response(continuation: Option<&str>, session_token: Option<&str>) -> CosmosDbResponse {
    CosmosDbResponse {
        body: r#"{"Documents":[]}"#.into(),
        request_charge: Some(1.5),
        continuation: continuation.map(str::to_string),
        item_count: Some(0),
        activity_id: Some("activity-1".into()),
        query_metrics: None,
        index_metrics: None,
        session_token: session_token.map(str::to_string),
        retry_after_ms: None,
    }
}

#[test]
fn cosmosdb_cursor_round_trips_continuation_and_session_state() {
    let encoded = cursor_from_response(&response(Some("next/page+token"), Some("0:42")))
        .unwrap()
        .unwrap();
    let decoded = decode_cosmosdb_cursor(&encoded).unwrap();

    assert_eq!(decoded.version, COSMOSDB_CURSOR_VERSION);
    assert_eq!(decoded.continuation, "next/page+token");
    assert_eq!(decoded.session_token.as_deref(), Some("0:42"));
    assert!(!encoded.contains("next/page+token"));
}

#[test]
fn cosmosdb_cursor_accepts_legacy_raw_continuation_tokens() {
    let decoded = decode_cosmosdb_cursor("legacy-token").unwrap();

    assert_eq!(decoded.continuation, "legacy-token");
    assert_eq!(decoded.session_token, None);
}

#[test]
fn cosmosdb_cursor_rejects_header_injection_characters() {
    let error = decode_cosmosdb_cursor("next\r\nx-ms-date: injected").unwrap_err();

    assert_eq!(error.code, "cosmosdb-continuation-invalid");
}

#[test]
fn cosmosdb_cursor_rejects_encoded_header_injection_characters() {
    let encoded = URL_SAFE_NO_PAD.encode(
        serde_json::to_vec(&CosmosDbPageCursor {
            version: COSMOSDB_CURSOR_VERSION,
            continuation: "next".into(),
            session_token: Some("0:7\ninvalid".into()),
        })
        .unwrap(),
    );

    let error = decode_cosmosdb_cursor(&encoded).unwrap_err();

    assert_eq!(error.code, "cosmosdb-continuation-invalid");
}

#[test]
fn cosmosdb_result_paging_uses_an_opaque_cursor() {
    let mut result = build_result(ResultEnvelopeInput {
        engine: "cosmosdb",
        summary: "Cosmos DB query returned 2 rows.".into(),
        default_renderer: "document",
        renderer_modes: vec!["document", "table", "json"],
        payloads: vec![payload_document(
            serde_json::json!([{"id": "1"}, {"id": "2"}]),
        )],
        notices: vec![],
        duration_ms: 1,
        row_limit: Some(2),
        truncated: false,
        explain_payload: None,
    });

    apply_cosmosdb_result_paging(&mut result, &response(Some("next"), Some("0:7")), 2).unwrap();

    let page_info = result.page_info.as_ref().unwrap();
    assert!(page_info.has_more);
    assert_eq!(page_info.page_index, 0);
    assert_eq!(page_info.page_size, 2);
    assert_eq!(result.continuation_token, page_info.next_cursor);
    assert_eq!(
        decode_cosmosdb_cursor(page_info.next_cursor.as_deref().unwrap())
            .unwrap()
            .session_token
            .as_deref(),
        Some("0:7")
    );
}

#[test]
fn cosmosdb_result_paging_clears_has_more_without_a_continuation() {
    let mut result = build_result(ResultEnvelopeInput {
        engine: "cosmosdb",
        summary: "Cosmos DB query returned no rows.".into(),
        default_renderer: "document",
        renderer_modes: vec!["document"],
        payloads: vec![payload_document(serde_json::json!([]))],
        notices: vec![],
        duration_ms: 1,
        row_limit: Some(25),
        truncated: false,
        explain_payload: None,
    });

    apply_cosmosdb_result_paging(&mut result, &response(None, None), 25).unwrap();

    assert!(!result.page_info.unwrap().has_more);
    assert_eq!(result.continuation_token, None);
    assert_eq!(result.truncated, Some(false));
}

#[tokio::test]
async fn cosmosdb_fetch_page_replays_opaque_continuation_and_session_state() {
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
        let body = r#"{"Documents":[{"id":"2","status":"active"}],"_count":1}"#;
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nx-ms-request-charge: 2.75\r\nx-ms-item-count: 1\r\nx-ms-activity-id: activity-page-2\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
        stream.write_all(response.as_bytes()).await.unwrap();
        String::from_utf8(request).unwrap()
    });
    let cursor = cursor_from_response(&response(Some("page-2"), Some("0:41")))
        .unwrap()
        .unwrap();
    let request = ResultPageRequest {
        execution_id: Some("execution-page-2".into()),
        tab_id: "tab-cosmos".into(),
        connection_id: "conn-cosmos".into(),
        environment_id: "env-local".into(),
        language: "sql".into(),
        query_text: "select * from c".into(),
        selected_text: None,
        renderer: "document".into(),
        page_size: Some(25),
        page_index: Some(1),
        cursor: Some(cursor),
        document_efficiency_mode: None,
        scoped_target: None,
    };

    let page = fetch_cosmosdb_page(&connection(&format!("http://{address}")), &request)
        .await
        .unwrap();
    let wire_request = server.await.unwrap().to_ascii_lowercase();

    assert!(wire_request.contains("x-ms-continuation: page-2"));
    assert!(wire_request.contains("x-ms-session-token: 0:41"));
    assert!(wire_request.contains("x-ms-max-item-count: 25"));
    assert_eq!(page.page_info.page_index, 1);
    assert_eq!(page.page_info.buffered_rows, 1);
    assert!(!page.page_info.has_more);
    assert_eq!(page.page_info.next_cursor, None);
    assert_eq!(page.payload["renderer"], "document");
    assert_eq!(page.payload["documents"][0]["id"], "2");
    assert!(page.notices.iter().any(|notice| notice.contains("2.75 RU")));
    assert!(page
        .notices
        .iter()
        .any(|notice| notice.contains("activity-page-2")));
}

fn connection(endpoint: &str) -> ResolvedConnectionProfile {
    ResolvedConnectionProfile {
        id: "conn-cosmos".into(),
        name: "Cosmos DB".into(),
        engine: "cosmosdb".into(),
        family: "document".into(),
        host: "127.0.0.1".into(),
        port: None,
        database: Some("catalog".into()),
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
        cosmos_db_options: Some(CosmosDbConnectionOptions {
            connect_mode: Some("emulator".into()),
            api: Some("nosql".into()),
            account_endpoint: Some(endpoint.into()),
            database_name: Some("catalog".into()),
            container_prefix: Some("orders".into()),
            auth_mode: Some("emulator".into()),
            max_retry_attempts: Some(0),
            ..CosmosDbConnectionOptions::default()
        }),
        search_options: None,
        time_series_options: None,
        graph_options: None,
        mongodb_options: None,
        warehouse_options: None,
        read_only: true,
    }
}
