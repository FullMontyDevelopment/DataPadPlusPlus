use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};

use super::*;

#[test]
fn execute_sqlite_query_reads_tables_from_database_path() {
    tauri::async_runtime::block_on(async {
        let path = std::env::temp_dir().join(format!(
            "datapadplusplus-sqlite-query-{}.sqlite",
            std::process::id()
        ));
        let _ = std::fs::remove_file(&path);
        let setup_pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(
                SqliteConnectOptions::new()
                    .filename(&path)
                    .create_if_missing(true),
            )
            .await
            .expect("create sqlite fixture");
        sqlx::query("create table accounts (id integer primary key, name text not null)")
            .execute(&setup_pool)
            .await
            .expect("create accounts table");
        sqlx::query("insert into accounts (id, name) values (1, 'Avery')")
            .execute(&setup_pool)
            .await
            .expect("seed accounts table");
        setup_pool.close().await;

        let result = execute_sqlite_query(
            &SqliteAdapter,
            &test_connection(path.to_string_lossy().as_ref()),
            &ExecutionRequest {
                execution_id: None,
                tab_id: "tab-sqlite".into(),
                connection_id: "conn-sqlite".into(),
                environment_id: "env-dev".into(),
                language: "sql".into(),
                query_text: "select * from accounts;".into(),
                execution_input_mode: None,
                script_text: None,
                selected_text: None,
                mode: None,
                row_limit: Some(20),
                document_efficiency_mode: None,
                confirmed_guardrail_id: None,
            },
            Vec::new(),
        )
        .await
        .expect("query sqlite table");

        let table = result
            .payloads
            .iter()
            .find(|payload| {
                payload.get("renderer").and_then(serde_json::Value::as_str) == Some("table")
            })
            .expect("table payload");

        assert_eq!(table["columns"], serde_json::json!(["id", "name"]));
        assert_eq!(table["rows"], serde_json::json!([["1", "Avery"]]));

        let _ = std::fs::remove_file(&path);
    });
}

#[test]
fn sqlite_modes_generate_query_plan_and_bytecode() {
    assert_eq!(
        sqlite_statement_for_mode("select * from accounts;", "explain"),
        "EXPLAIN QUERY PLAN select * from accounts"
    );
    assert_eq!(
        sqlite_statement_for_mode("select * from accounts", "profile"),
        "EXPLAIN select * from accounts"
    );
}

#[test]
fn sqlite_read_only_guard_detects_mutations() {
    assert!(is_mutating_sqlite("create table accounts(id int)"));
    assert!(is_mutating_sqlite("pragma foreign_keys = off"));
    assert!(is_mutating_sqlite("vacuum"));
    assert!(!is_mutating_sqlite("pragma table_info(accounts)"));
    assert!(!is_mutating_sqlite("select * from accounts"));
}

#[test]
fn execute_sqlite_query_returns_batch_sections_for_multiple_selects() {
    tauri::async_runtime::block_on(async {
        let path = std::env::temp_dir().join(format!(
            "datapadplusplus-sqlite-batch-{}.sqlite",
            std::process::id()
        ));
        let _ = std::fs::remove_file(&path);
        let setup_pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(
                SqliteConnectOptions::new()
                    .filename(&path)
                    .create_if_missing(true),
            )
            .await
            .expect("create sqlite fixture");
        sqlx::query("create table accounts (id integer primary key, name text not null)")
            .execute(&setup_pool)
            .await
            .expect("create accounts table");
        sqlx::query("insert into accounts (id, name) values (1, 'Avery')")
            .execute(&setup_pool)
            .await
            .expect("seed accounts table");
        setup_pool.close().await;

        let result = execute_sqlite_query(
            &SqliteAdapter,
            &test_connection(path.to_string_lossy().as_ref()),
            &ExecutionRequest {
                execution_id: None,
                tab_id: "tab-sqlite".into(),
                connection_id: "conn-sqlite".into(),
                environment_id: "env-dev".into(),
                language: "sql".into(),
                query_text: "select id from accounts; select name from accounts;".into(),
                execution_input_mode: None,
                script_text: None,
                selected_text: None,
                mode: None,
                row_limit: Some(20),
                document_efficiency_mode: None,
                confirmed_guardrail_id: None,
            },
            Vec::new(),
        )
        .await
        .expect("query sqlite batch");

        assert_eq!(result.default_renderer, "batch");
        let batch = result
            .payloads
            .iter()
            .find(|payload| {
                payload.get("renderer").and_then(serde_json::Value::as_str) == Some("batch")
            })
            .expect("batch payload");
        assert_eq!(batch["sections"].as_array().unwrap().len(), 2);
        assert_eq!(
            batch["sections"][0]["payloads"][0]["rows"],
            serde_json::json!([["1"]])
        );
        assert_eq!(
            batch["sections"][1]["payloads"][0]["rows"],
            serde_json::json!([["Avery"]])
        );

        let _ = std::fs::remove_file(&path);
    });
}

fn test_connection(path: &str) -> ResolvedConnectionProfile {
    ResolvedConnectionProfile {
        id: "conn-sqlite".into(),
        name: "SQLite".into(),
        engine: "sqlite".into(),
        family: "sql".into(),
        host: path.into(),
        port: None,
        database: Some(path.into()),
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
        read_only: false,
    }
}
