use std::{path::PathBuf, str::FromStr, time::Duration};

use sqlx::{
    sqlite::{
        SqliteAutoVacuum, SqliteConnectOptions, SqliteJournalMode, SqliteLockingMode,
        SqlitePoolOptions, SqliteSynchronous,
    },
    Column, Row, SqlitePool, TypeInfo,
};

use crate::domain::models::SqliteConnectionOptions;

use super::super::super::*;

pub(super) fn stringify_sqlite_cell(row: &sqlx::sqlite::SqliteRow, index: usize) -> String {
    stringify_sqlx_common(
        [
            row.try_get::<Option<String>, _>(index).ok().flatten(),
            row.try_get::<Option<i64>, _>(index)
                .ok()
                .flatten()
                .map(|item| item.to_string()),
            row.try_get::<Option<i32>, _>(index)
                .ok()
                .flatten()
                .map(|item| item.to_string()),
            row.try_get::<Option<f64>, _>(index)
                .ok()
                .flatten()
                .map(|item| item.to_string()),
            row.try_get::<Option<bool>, _>(index)
                .ok()
                .flatten()
                .map(|item| item.to_string()),
            None,
            row.try_get::<Option<Vec<u8>>, _>(index)
                .ok()
                .flatten()
                .map(|item| format!("<{} bytes>", item.len())),
        ],
        format!("<{}>", row.columns()[index].type_info().name()),
    )
}

pub(super) async fn sqlite_pool(
    connection: &ResolvedConnectionProfile,
) -> Result<SqlitePool, CommandError> {
    let options = sqlite_connect_options(connection)?;

    Ok(SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await?)
}

fn sqlite_connect_options(
    connection: &ResolvedConnectionProfile,
) -> Result<SqliteConnectOptions, CommandError> {
    let sqlite_options = connection.sqlite_options.as_ref();
    let raw = connection
        .connection_string
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .or(connection.database.as_deref())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(connection.host.as_str())
        .trim();

    if raw.is_empty() {
        return Err(CommandError::new(
            "sqlite-path-required",
            "Choose a SQLite database file before connecting.",
        ));
    }

    if sqlite_options
        .and_then(|options| options.encryption_provider.as_deref())
        .is_some_and(|provider| !provider.eq_ignore_ascii_case("none"))
    {
        return Err(CommandError::new(
            "sqlite-encryption-unavailable",
            "This DataPad++ build uses the standard SQLite driver. SQLCipher/provider-specific encrypted SQLite files need a build with that encryption provider enabled.",
        ));
    }

    let normalized = normalize_sqlite_input(raw, sqlite_options)?;
    let mut options = if let Some(dsn) = normalized.dsn {
        SqliteConnectOptions::from_str(&dsn)?
    } else if normalized.in_memory {
        SqliteConnectOptions::new()
            .filename(":memory:")
            .in_memory(true)
    } else {
        SqliteConnectOptions::new().filename(PathBuf::from(normalized.path))
    };

    if normalized.shared_cache {
        options = options.shared_cache(true);
    }
    if normalized.immutable {
        options = options.immutable(true);
    }
    if normalized.read_only || connection.read_only {
        options = options.read_only(true);
    }
    options = options.create_if_missing(normalized.create_if_missing && !normalized.read_only);

    if let Some(timeout) = normalized.busy_timeout_ms {
        options = options.busy_timeout(Duration::from_millis(timeout));
    }

    if let Some(journal_mode) = normalized.journal_mode.as_deref() {
        options = options.journal_mode(parse_journal_mode(journal_mode)?);
    }
    if let Some(synchronous_mode) = normalized.synchronous_mode.as_deref() {
        options = options.synchronous(parse_synchronous_mode(synchronous_mode)?);
    }
    if let Some(locking_mode) = normalized.locking_mode.as_deref() {
        options = options.locking_mode(parse_locking_mode(locking_mode)?);
    }
    if let Some(auto_vacuum) = normalized.auto_vacuum.as_deref() {
        options = options.auto_vacuum(parse_auto_vacuum(auto_vacuum)?);
    }
    if let Some(page_size) = normalized.page_size {
        options = options.page_size(page_size);
    }
    if let Some(foreign_keys) = normalized.foreign_keys {
        options = options.foreign_keys(foreign_keys);
    }

    for (key, value) in normalized.pragmas {
        options = options.pragma(key, value);
    }

    Ok(options)
}

#[derive(Default)]
struct NormalizedSqliteOptions {
    dsn: Option<String>,
    path: String,
    in_memory: bool,
    read_only: bool,
    create_if_missing: bool,
    shared_cache: bool,
    immutable: bool,
    busy_timeout_ms: Option<u64>,
    journal_mode: Option<String>,
    synchronous_mode: Option<String>,
    locking_mode: Option<String>,
    auto_vacuum: Option<String>,
    page_size: Option<u32>,
    foreign_keys: Option<bool>,
    pragmas: Vec<(String, String)>,
}

fn normalize_sqlite_input(
    raw: &str,
    sqlite_options: Option<&SqliteConnectionOptions>,
) -> Result<NormalizedSqliteOptions, CommandError> {
    let mut normalized = NormalizedSqliteOptions {
        path: raw.to_string(),
        ..Default::default()
    };

    if raw.starts_with("sqlite:") {
        normalized.dsn = Some(raw.to_string());
    } else if raw.trim() == ":memory:" {
        normalized.in_memory = true;
    } else if raw.starts_with("file:") {
        normalized.dsn = Some(format!("sqlite://{raw}"));
    } else if looks_like_sqlite_connection_string(raw) {
        apply_sqlite_connection_string(raw, &mut normalized)?;
    }

    if let Some(options) = sqlite_options {
        apply_sqlite_connection_options(options, &mut normalized);
    }

    Ok(normalized)
}

fn looks_like_sqlite_connection_string(raw: &str) -> bool {
    raw.split(';').any(|part| {
        part.split_once('=')
            .map(|(key, _)| key.trim().eq_ignore_ascii_case("data source"))
            .unwrap_or(false)
    })
}

fn apply_sqlite_connection_string(
    raw: &str,
    normalized: &mut NormalizedSqliteOptions,
) -> Result<(), CommandError> {
    for part in raw.split(';').filter(|part| !part.trim().is_empty()) {
        let Some((key, value)) = part.split_once('=') else {
            continue;
        };
        let key = key.trim().to_ascii_lowercase();
        let value = value.trim();

        match key.as_str() {
            "data source" | "datasource" | "filename" => {
                normalized.path = value.to_string();
                normalized.dsn = None;
                normalized.in_memory = value == ":memory:";
                if value.starts_with("file:") {
                    normalized.dsn = Some(format!("sqlite://{value}"));
                }
            }
            "mode" => match value.to_ascii_lowercase().as_str() {
                "readonly" | "read only" | "ro" => normalized.read_only = true,
                "readwrite" | "read write" | "rw" => normalized.create_if_missing = false,
                "readwritecreate" | "read write create" | "rwc" => {
                    normalized.create_if_missing = true
                }
                "memory" => normalized.in_memory = true,
                other => {
                    return Err(CommandError::new(
                        "sqlite-connection-string-mode",
                        format!("SQLite connection string mode `{other}` is not supported."),
                    ));
                }
            },
            "cache" => match value.to_ascii_lowercase().as_str() {
                "shared" => normalized.shared_cache = true,
                "private" | "default" => normalized.shared_cache = false,
                _ => {}
            },
            "readonly" | "read only" => normalized.read_only = parse_bool(value),
            "foreign keys" | "foreignkeys" => normalized.foreign_keys = Some(parse_bool(value)),
            "busytimeout" | "busy timeout" | "default timeout" => {
                normalized.busy_timeout_ms = value.parse::<u64>().ok()
            }
            "password" => {
                return Err(CommandError::new(
                    "sqlite-encryption-unavailable",
                    "Password-protected SQLite connection strings require SQLCipher/provider-specific encryption support, which is not enabled in this build.",
                ));
            }
            _ => {}
        }
    }
    Ok(())
}

fn apply_sqlite_connection_options(
    options: &SqliteConnectionOptions,
    normalized: &mut NormalizedSqliteOptions,
) {
    match options.open_mode.as_deref().unwrap_or_default() {
        "read-only" => normalized.read_only = true,
        "read-write-create" => normalized.create_if_missing = true,
        "memory" => normalized.in_memory = true,
        "shared-memory" => {
            normalized.in_memory = true;
            normalized.shared_cache = true;
        }
        "uri" if normalized.dsn.is_none() && normalized.path.starts_with("file:") => {
            normalized.dsn = Some(format!("sqlite://{}", normalized.path));
        }
        _ => {}
    }

    if options.use_uri_filename == Some(true)
        && normalized.dsn.is_none()
        && normalized.path.starts_with("file:")
    {
        normalized.dsn = Some(format!("sqlite://{}", normalized.path));
    }

    normalized.create_if_missing |= options.create_if_missing.unwrap_or(false);
    normalized.immutable |= options.immutable.unwrap_or(false);
    normalized.shared_cache |= options.shared_cache.unwrap_or(false);
    if options.private_cache == Some(true) {
        normalized.shared_cache = false;
    }
    normalized.busy_timeout_ms = options.busy_timeout_ms.or(options.default_timeout_ms);
    normalized.journal_mode = options.journal_mode.clone();
    normalized.synchronous_mode = options.synchronous_mode.clone();
    normalized.locking_mode = options.locking_mode.clone();
    normalized.auto_vacuum = options.auto_vacuum.clone();
    normalized.page_size = options.page_size;
    normalized.foreign_keys = options.foreign_keys;

    push_optional_pragma(
        &mut normalized.pragmas,
        "cache_size",
        options.cache_size.map(|value| value.to_string()),
    );
    push_optional_pragma(
        &mut normalized.pragmas,
        "recursive_triggers",
        options
            .recursive_triggers
            .map(|value| if value { "ON" } else { "OFF" }.to_string()),
    );
    push_optional_pragma(
        &mut normalized.pragmas,
        "case_sensitive_like",
        options
            .case_sensitive_like
            .map(|value| if value { "ON" } else { "OFF" }.to_string()),
    );
    push_optional_pragma(
        &mut normalized.pragmas,
        "temp_store",
        options
            .temp_store_mode
            .as_deref()
            .map(sqlite_pragma_enum_value),
    );
    push_optional_pragma(
        &mut normalized.pragmas,
        "mmap_size",
        options.mmap_size.map(|value| value.to_string()),
    );
    push_optional_pragma(
        &mut normalized.pragmas,
        "application_id",
        options.application_id.map(|value| value.to_string()),
    );
    push_optional_pragma(
        &mut normalized.pragmas,
        "user_version",
        options.user_version.map(|value| value.to_string()),
    );
    push_optional_pragma(
        &mut normalized.pragmas,
        "encoding",
        options.encoding.clone(),
    );
}

fn push_optional_pragma(pragmas: &mut Vec<(String, String)>, key: &str, value: Option<String>) {
    if let Some(value) = value.filter(|value| !value.trim().is_empty()) {
        pragmas.push((key.into(), value));
    }
}

fn sqlite_pragma_enum_value(value: &str) -> String {
    value.replace('-', "_").to_ascii_uppercase()
}

fn parse_bool(value: &str) -> bool {
    matches!(
        value.trim().to_ascii_lowercase().as_str(),
        "1" | "true" | "yes" | "on"
    )
}

fn parse_journal_mode(value: &str) -> Result<SqliteJournalMode, CommandError> {
    match value.trim().to_ascii_lowercase().as_str() {
        "delete" => Ok(SqliteJournalMode::Delete),
        "truncate" => Ok(SqliteJournalMode::Truncate),
        "persist" => Ok(SqliteJournalMode::Persist),
        "memory" => Ok(SqliteJournalMode::Memory),
        "wal" => Ok(SqliteJournalMode::Wal),
        "off" => Ok(SqliteJournalMode::Off),
        other => Err(CommandError::new(
            "sqlite-journal-mode",
            format!("SQLite journal mode `{other}` is not supported."),
        )),
    }
}

fn parse_synchronous_mode(value: &str) -> Result<SqliteSynchronous, CommandError> {
    match value.trim().to_ascii_lowercase().as_str() {
        "off" => Ok(SqliteSynchronous::Off),
        "normal" => Ok(SqliteSynchronous::Normal),
        "full" => Ok(SqliteSynchronous::Full),
        "extra" => Ok(SqliteSynchronous::Extra),
        other => Err(CommandError::new(
            "sqlite-synchronous-mode",
            format!("SQLite synchronous mode `{other}` is not supported."),
        )),
    }
}

fn parse_locking_mode(value: &str) -> Result<SqliteLockingMode, CommandError> {
    match value.trim().to_ascii_lowercase().as_str() {
        "normal" => Ok(SqliteLockingMode::Normal),
        "exclusive" => Ok(SqliteLockingMode::Exclusive),
        other => Err(CommandError::new(
            "sqlite-locking-mode",
            format!("SQLite locking mode `{other}` is not supported."),
        )),
    }
}

fn parse_auto_vacuum(value: &str) -> Result<SqliteAutoVacuum, CommandError> {
    match value.trim().to_ascii_lowercase().as_str() {
        "none" => Ok(SqliteAutoVacuum::None),
        "full" => Ok(SqliteAutoVacuum::Full),
        "incremental" => Ok(SqliteAutoVacuum::Incremental),
        other => Err(CommandError::new(
            "sqlite-auto-vacuum",
            format!("SQLite auto-vacuum mode `{other}` is not supported."),
        )),
    }
}

pub(super) async fn test_sqlite_connection(
    connection: &ResolvedConnectionProfile,
) -> Result<ConnectionTestResult, CommandError> {
    let started = Instant::now();
    let pool = sqlite_pool(connection).await?;
    let _: i64 = sqlx::query_scalar("select 1").fetch_one(&pool).await?;
    let table_count: i64 = sqlx::query_scalar(
        "select count(*) from sqlite_master where type in ('table', 'view') and name not like 'sqlite_%'",
    )
    .fetch_one(&pool)
    .await?;
    pool.close().await;
    let warnings = if table_count == 0 {
        vec![
            "SQLite opened this file, but no user tables or views were found. If `select 1` works but `accounts` does not, verify the Database file path or create the starter schema in this file."
                .into(),
        ]
    } else {
        Vec::new()
    };

    Ok(ConnectionTestResult {
        ok: true,
        engine: connection.engine.clone(),
        message: format!("Connection test succeeded for {}.", connection.name),
        warnings,
        resolved_host: connection.host.clone(),
        resolved_database: connection.database.clone(),
        duration_ms: Some(duration_ms(started)),
    })
}

#[cfg(test)]
mod tests {
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
}
