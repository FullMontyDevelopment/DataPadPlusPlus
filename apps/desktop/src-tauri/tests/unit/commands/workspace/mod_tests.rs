use super::*;
use crate::domain::models::QueryTabState;

#[test]
fn asynchronous_metadata_refresh_preserves_concurrent_saved_edits_and_selection() {
    let mut before = crate::app::runtime::blank_workspace_snapshot();
    before.tabs.push(QueryTabState {
        id: "metrics".into(),
        tab_kind: Some("metrics".into()),
        ..Default::default()
    });
    let mut refreshed = before.clone();
    refreshed.tabs[0].metrics_state = Some(serde_json::json!({"diagnostics":{"rows":1}}));
    refreshed.tabs[0].status = "success".into();
    let mut current = before.clone();
    current
        .library_nodes
        .push(crate::domain::models::LibraryNode {
            id: "saved".into(),
            query_text: Some("new saved revision".into()),
            ..Default::default()
        });
    current.ui.active_tab_id = "another-tab".into();
    current.workspace_revision = 42;
    assert!(merge_refreshed_tab(&mut current, &before, &refreshed, "metrics").unwrap());
    assert_eq!(
        current.library_nodes[0].query_text.as_deref(),
        Some("new saved revision")
    );
    assert_eq!(current.ui.active_tab_id, "another-tab");
    assert_eq!(current.workspace_revision, 42);
    assert_eq!(current.tabs[0].status, "success");
}

#[test]
fn asynchronous_metadata_refresh_never_resurrects_closed_tabs_or_overwrites_changed_targets() {
    let mut before = crate::app::runtime::blank_workspace_snapshot();
    before.tabs.push(QueryTabState {
        id: "object".into(),
        environment_id: "before".into(),
        ..Default::default()
    });
    let refreshed = before.clone();
    let mut current = before.clone();
    current.tabs[0].environment_id = "after".into();
    assert!(!merge_refreshed_tab(&mut current, &before, &refreshed, "object").unwrap());
    assert_eq!(current.tabs[0].environment_id, "after");
    current.tabs.clear();
    assert!(!merge_refreshed_tab(&mut current, &before, &refreshed, "object").unwrap());
    assert!(current.tabs.is_empty());
}

fn test_sqlite_path(name: &str) -> PathBuf {
    let unique = crate::app::runtime::generate_id(name);
    std::env::temp_dir()
        .join("datapadplusplus-local-db-tests")
        .join(format!("{unique}.sqlite"))
}

fn test_local_path(name: &str, extension: &str) -> PathBuf {
    let unique = crate::app::runtime::generate_id(name);
    std::env::temp_dir()
        .join("datapadplusplus-local-db-tests")
        .join(format!("{unique}.{extension}"))
}

#[test]
fn canonical_document_exports_stream_json_and_ndjson_without_an_ipc_content_copy() {
    let documents = vec![
        serde_json::json!({ "_id": 1, "name": "Alpha" }),
        serde_json::json!({ "_id": 2, "name": "Beta" }),
    ];
    let mut json = Vec::new();
    let mut ndjson = Vec::new();

    super::library::write_document_result_export(&mut json, &documents, "json").unwrap();
    super::library::write_document_result_export(&mut ndjson, &documents, "ndjson").unwrap();

    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&json).unwrap(),
        serde_json::Value::Array(documents.clone())
    );
    assert_eq!(
        String::from_utf8(ndjson).unwrap(),
        "{\"_id\":1,\"name\":\"Alpha\"}\n{\"_id\":2,\"name\":\"Beta\"}"
    );
}

#[test]
fn empty_sqlite_database_creation_is_connectable() {
    tauri::async_runtime::block_on(async {
        let path = test_sqlite_path("empty");
        create_sqlite_local_database(&path, "empty").await.unwrap();

        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(
                SqliteConnectOptions::new()
                    .filename(&path)
                    .create_if_missing(false),
            )
            .await
            .unwrap();
        let value: i64 = sqlx::query_scalar("select 1")
            .fetch_one(&pool)
            .await
            .unwrap();
        pool.close().await;
        let _ = std::fs::remove_file(path);

        assert_eq!(value, 1);
    });
}

#[test]
fn starter_sqlite_database_creation_seeds_accounts_schema() {
    tauri::async_runtime::block_on(async {
        let path = test_sqlite_path("starter");
        create_sqlite_local_database(&path, "starter")
            .await
            .unwrap();

        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(
                SqliteConnectOptions::new()
                    .filename(&path)
                    .create_if_missing(false),
            )
            .await
            .unwrap();
        let account_count: i64 = sqlx::query_scalar("select count(*) from accounts")
            .fetch_one(&pool)
            .await
            .unwrap();
        let item_count: i64 = sqlx::query_scalar("select count(*) from items")
            .fetch_one(&pool)
            .await
            .unwrap();
        let active_count: i64 = sqlx::query_scalar("select count(*) from active_accounts")
            .fetch_one(&pool)
            .await
            .unwrap();
        pool.close().await;
        let _ = std::fs::remove_file(path);

        assert_eq!(account_count, 2);
        assert_eq!(item_count, 1);
        assert_eq!(active_count, 1);
    });
}

#[test]
fn duckdb_database_creation_supports_starter_table() {
    let path = test_local_path("duckdb-starter", "duckdb");
    create_duckdb_local_database(&path, "starter").unwrap();

    let db = DuckDbConnection::open(&path).unwrap();
    let count: i64 = db
        .query_row("select count(*) from items", [], |row| row.get(0))
        .unwrap();
    let _ = std::fs::remove_file(path);

    assert_eq!(count, 1);
}

#[test]
fn litedb_database_creation_prepares_local_file() {
    let path = test_local_path("litedb-empty", "db");
    let warnings = create_litedb_local_database(&path).unwrap();
    let metadata = std::fs::metadata(&path).unwrap();
    let _ = std::fs::remove_file(path);

    assert!(metadata.is_file());
    assert_eq!(warnings.len(), 1);
}
