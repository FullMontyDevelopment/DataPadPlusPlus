use super::*;

#[test]
fn sqlite_connection_fails_for_missing_local_file_instead_of_creating_empty_database() {
    tauri::async_runtime::block_on(async {
        let path = std::env::temp_dir().join(format!(
            "datapadplusplus-missing-{}.sqlite",
            std::process::id()
        ));
        let _ = std::fs::remove_file(&path);
        let connection = test_connection(path.to_string_lossy().as_ref());

        let error = match test_sqlite_connection(&connection).await {
            Ok(_) => panic!("missing file should not be created"),
            Err(error) => error,
        };

        assert_eq!(error.code, "sqlite-open-file-failed");
        assert!(!path.exists());
    });
}

#[test]
fn sqlite_connection_warns_when_file_has_no_user_tables() {
    tauri::async_runtime::block_on(async {
        let path = std::env::temp_dir().join(format!(
            "datapadplusplus-empty-{}.sqlite",
            std::process::id()
        ));
        let _ = std::fs::remove_file(&path);
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(
                SqliteConnectOptions::new()
                    .filename(&path)
                    .create_if_missing(true),
            )
            .await
            .expect("create empty sqlite file");
        pool.close().await;

        let result = test_sqlite_connection(&test_connection(path.to_string_lossy().as_ref()))
            .await
            .expect("connect to empty sqlite file");

        assert!(result
            .warnings
            .iter()
            .any(|warning| warning.contains("no user tables or views")));
        let _ = std::fs::remove_file(path);
    });
}

#[test]
fn sqlite_connection_string_options_parse_ado_style_modes() {
    let normalized = normalize_sqlite_input(
        "Data Source=file:catalog.db?mode=ro&cache=shared;Mode=ReadOnly;Cache=Shared;",
        None,
    )
    .expect("normalize sqlite connection string");

    assert_eq!(
        normalized.dsn.as_deref(),
        Some("sqlite://file:catalog.db?mode=ro&cache=shared")
    );
    assert!(normalized.read_only);
    assert!(normalized.shared_cache);
    assert!(!normalized.create_if_missing);
}

#[test]
fn sqlite_options_apply_open_mode_and_pragmas() {
    let normalized = normalize_sqlite_input(
        "catalog.sqlite",
        Some(&SqliteConnectionOptions {
            open_mode: Some("read-write-create".into()),
            busy_timeout_ms: Some(2500),
            journal_mode: Some("wal".into()),
            foreign_keys: Some(false),
            recursive_triggers: Some(true),
            cache_size: Some(-4000),
            ..Default::default()
        }),
    )
    .expect("normalize sqlite options");

    assert_eq!(normalized.path, "catalog.sqlite");
    assert!(normalized.create_if_missing);
    assert_eq!(normalized.busy_timeout_ms, Some(2500));
    assert_eq!(normalized.journal_mode.as_deref(), Some("wal"));
    assert_eq!(normalized.foreign_keys, Some(false));
    assert!(normalized
        .pragmas
        .iter()
        .any(|(key, value)| key == "recursive_triggers" && value == "ON"));
    assert!(normalized
        .pragmas
        .iter()
        .any(|(key, value)| key == "cache_size" && value == "-4000"));
}

#[test]
fn sqlite_encryption_options_are_explicitly_gated() {
    tauri::async_runtime::block_on(async {
        let mut connection = test_connection(":memory:");
        connection.sqlite_options = Some(SqliteConnectionOptions {
            encryption_provider: Some("sqlcipher".into()),
            ..Default::default()
        });

        let error = match test_sqlite_connection(&connection).await {
            Ok(_) => panic!("standard sqlite build should reject encrypted mode"),
            Err(error) => error,
        };

        assert_eq!(error.code, "sqlite-encryption-unavailable");
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
