use super::*;
use crate::domain::models::{ExecutionCapabilities, ExplorerNode};

fn request(scope: Option<&str>, cursor: Option<String>) -> ExplorerRequest {
    ExplorerRequest {
        connection_id: "connection-1".into(),
        environment_id: "environment-1".into(),
        limit: Some(2),
        scope: scope.map(str::to_string),
        cursor,
    }
}

fn response() -> ExplorerResponse {
    ExplorerResponse {
        connection_id: "connection-1".into(),
        environment_id: "environment-1".into(),
        scope: None,
        summary: "Explorer".into(),
        capabilities: ExecutionCapabilities {
            can_cancel: false,
            can_explain: false,
            supports_live_metadata: true,
            editor_language: "sql".into(),
            default_row_limit: 100,
        },
        nodes: (0..5)
            .map(|index| ExplorerNode {
                id: format!("node-{index}"),
                label: format!("Node {index}"),
                family: "sql".into(),
                kind: "table".into(),
                detail: String::new(),
                ..ExplorerNode::default()
            })
            .collect(),
        page_info: None,
    }
}

#[test]
fn pages_and_binds_cursors_to_the_scope() {
    let first = apply_default_explorer_paging("postgresql", &request(None, None), response())
        .expect("first page");
    assert_eq!(first.nodes.len(), 2);
    assert!(first.page_info.as_ref().expect("page info").has_more);
    let cursor = first
        .page_info
        .and_then(|page| page.next_cursor)
        .expect("cursor");

    let second = apply_default_explorer_paging(
        "postgresql",
        &request(None, Some(cursor.clone())),
        response(),
    )
    .expect("second page");
    assert_eq!(second.nodes[0].id, "node-2");

    let result = apply_default_explorer_paging(
        "postgresql",
        &request(Some("other"), Some(cursor)),
        response(),
    );
    let error = match result {
        Ok(_) => panic!("scope mismatch should fail"),
        Err(error) => error,
    };
    assert_eq!(error.code, "invalid-explorer-cursor");
}

#[test]
fn continuation_fetches_enough_rows_for_the_requested_page() {
    let first = apply_default_explorer_paging("postgresql", &request(None, None), response())
        .expect("first page");
    let cursor = first
        .page_info
        .and_then(|page| page.next_cursor)
        .expect("cursor");
    let prepared = prepare_default_explorer_request("postgresql", &request(None, Some(cursor)))
        .expect("prepared request");

    assert_eq!(prepared.limit, Some(4));
    assert_eq!(prepared.cursor, None);
}

#[tokio::test]
async fn explorer_service_continuations_reach_objects_after_the_first_response() {
    use crate::domain::models::{
        CosmosDbConnectionOptions, ResolvedConnectionProfile, WarehouseConnectionOptions,
    };
    use serde_json::json;
    use tokio::{
        io::{AsyncReadExt, AsyncWriteExt},
        net::TcpListener,
    };

    for (engine, scope, field) in [
        ("dynamodb", "dynamodb:tables", "TableNames"),
        ("bigquery", "bigquery:datasets", "datasets"),
        ("bigquery", "warehouse:tables", "tables"),
        ("bigquery", "warehouse:views", "tables"),
        ("bigquery", "bigquery:jobs", "jobs"),
        ("bigquery", "bigquery:reservations", "reservations"),
        ("bigquery", "bigquery:dataset:catalog:routines", "routines"),
        ("bigquery", "bigquery:dataset:catalog:models", "models"),
        ("cosmosdb", "cosmos:databases", "Databases"),
        (
            "cosmosdb",
            "cosmos:containers:catalog",
            "DocumentCollections",
        ),
        (
            "cosmosdb",
            "cosmos:stored-procedures:catalog:items",
            "StoredProcedures",
        ),
        ("cosmosdb", "cosmos:triggers:catalog:items", "Triggers"),
        (
            "cosmosdb",
            "cosmos:udfs:catalog:items",
            "UserDefinedFunctions",
        ),
        ("cosmosdb", "cosmos:conflicts:catalog:items", "Conflicts"),
    ] {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            loop {
                let (mut stream, _) = listener.accept().await.unwrap();
                let mut bytes = Vec::new();
                let mut buffer = [0; 4096];
                loop {
                    let count = stream.read(&mut buffer).await.unwrap();
                    if count == 0 {
                        break;
                    }
                    bytes.extend_from_slice(&buffer[..count]);
                    if let Some(end) = bytes.windows(4).position(|part| part == b"\r\n\r\n") {
                        let headers = String::from_utf8_lossy(&bytes[..end]);
                        let length = headers
                            .lines()
                            .find_map(|line| {
                                let (name, value) = line.split_once(':')?;
                                name.eq_ignore_ascii_case("content-length")
                                    .then(|| value.trim().parse::<usize>().unwrap())
                            })
                            .unwrap_or(0);
                        if bytes.len() >= end + 4 + length {
                            break;
                        }
                    }
                }
                let wire = String::from_utf8(bytes).unwrap();
                let next = wire.contains("ExclusiveStartTableName")
                    || wire.contains("pageToken=")
                    || wire.to_ascii_lowercase().contains("x-ms-continuation:");
                if next && engine == "bigquery" {
                    assert!(
                        wire.contains("pageToken=next%2F%2Btoken"),
                        "opaque page token must be encoded"
                    );
                }
                if engine == "cosmosdb" {
                    assert!(wire.starts_with("GET "));
                    assert!(!wire
                        .to_ascii_lowercase()
                        .contains("x-ms-documentdb-isquery"));
                }
                let names = if next {
                    vec!["third"]
                } else {
                    vec!["first", "second"]
                };
                let objects = names.iter().map(|name| match field {
                    "TableNames" => json!(name),
                    "datasets" => json!({"datasetReference": {"datasetId": name}}),
                    "tables" => json!({"tableReference": {"tableId": name}, "type": if scope.ends_with("views") && next { "VIEW" } else { "TABLE" }}),
                    "jobs" => json!({"jobReference": {"jobId": name}}),
                    "reservations" => json!({"name": name}),
                    "routines" => json!({"routineReference": {"routineId": name}}),
                    "models" => json!({"modelReference": {"modelId": name}}),
                    _ => json!({"id": name}),
                }).collect::<Vec<_>>();
                let mut body = json!({field: objects});
                if !next {
                    body[if engine == "dynamodb" {
                        "LastEvaluatedTableName"
                    } else {
                        "nextPageToken"
                    }] = json!("next/+token");
                }
                let body = body.to_string();
                let headers = if !next && engine == "cosmosdb" {
                    "x-ms-continuation: next/+token\r\n"
                } else {
                    ""
                };
                let response = format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\n{headers}Connection: close\r\n\r\n{body}", body.len());
                stream.write_all(response.as_bytes()).await.unwrap();
            }
        });
        let endpoint = format!("http://{address}");
        let connection = ResolvedConnectionProfile {
            id: "connection-1".into(),
            name: "Isolated Explorer fixture".into(),
            engine: engine.into(),
            host: address.ip().to_string(),
            port: Some(address.port()),
            database: Some("catalog".into()),
            password: (engine == "bigquery").then(|| "fixture-only".into()),
            read_only: true,
            warehouse_options: Some(WarehouseConnectionOptions {
                endpoint_url: Some(endpoint.clone()),
                project_id: Some("fixture".into()),
                ..Default::default()
            }),
            cosmos_db_options: Some(CosmosDbConnectionOptions {
                account_endpoint: Some(endpoint),
                connect_mode: Some("emulator".into()),
                auth_mode: Some("emulator".into()),
                max_retry_attempts: Some(0),
                ..Default::default()
            }),
            ..Default::default()
        };
        let first = crate::adapters::list_explorer_nodes(&connection, &request(Some(scope), None))
            .await
            .unwrap();
        if scope == "warehouse:views" {
            // The first remote page contains only tables. It must not hide a
            // view that appears on a later page of this same mixed feed.
            server.abort();
            assert_eq!(first.nodes.len(), 1);
            assert_eq!(first.nodes[0].label, "third");
            assert!(!first.page_info.unwrap().has_more);
            continue;
        }
        let cursor = first.page_info.unwrap().next_cursor.unwrap_or_else(|| {
            panic!(
                "{engine} {scope}: expected more objects, got {}",
                first.nodes.len()
            )
        });
        let second =
            crate::adapters::list_explorer_nodes(&connection, &request(Some(scope), Some(cursor)))
                .await
                .unwrap();
        server.abort();
        assert_eq!(
            second.nodes.len(),
            1,
            "{engine} {scope} lost its continuation"
        );
        assert_eq!(second.nodes[0].label, "third");
        assert!(!second.page_info.unwrap().has_more);
    }
}

#[tokio::test]
async fn native_explorer_pages_are_bounded_and_fail_instead_of_reporting_false_empty_results() {
    let mut calls = 0;
    let items = collect_explorer_pages(Some(3), |_| {
        calls += 1;
        std::future::ready(Ok((vec![1, 2, 3, 4], Some("unused".into()))))
    })
    .await
    .unwrap();
    assert_eq!(items, vec![1, 2, 3]);
    assert_eq!(calls, 1);

    let repeated = collect_explorer_pages::<u8, _, _>(Some(10), |_| async {
        Ok((vec![], Some("repeated-sensitive-token".into())))
    })
    .await
    .unwrap_err();
    assert_eq!(repeated.code, "explorer-pagination-stalled");
    assert!(!repeated.message.contains("repeated-sensitive-token"));

    let mut calls = 0;
    let failed = collect_explorer_pages(Some(10), |_| {
        calls += 1;
        std::future::ready(if calls == 1 {
            Ok((vec![1], Some("next".into())))
        } else {
            Err(CommandError::new(
                "permission-denied",
                "Metadata unavailable",
            ))
        })
    })
    .await
    .unwrap_err();
    assert_eq!(failed.code, "permission-denied");
}
