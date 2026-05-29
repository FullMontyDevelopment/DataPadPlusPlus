use duckdb::{types::ValueRef, Connection};

use super::super::super::*;

pub(super) async fn test_duckdb_connection(
    connection: &ResolvedConnectionProfile,
) -> Result<ConnectionTestResult, CommandError> {
    let started = Instant::now();
    let db = open_duckdb_connection(connection)?;
    let version: String = db
        .query_row("select version()", [], |row| row.get(0))
        .map_err(duckdb_error)?;

    Ok(ConnectionTestResult {
        ok: true,
        engine: connection.engine.clone(),
        message: format!("DuckDB connection test succeeded for {}.", connection.name),
        warnings: vec![format!("Detected DuckDB version: {version}")],
        resolved_host: connection.host.clone(),
        resolved_database: Some(duckdb_database_path(connection)),
        duration_ms: Some(duration_ms(started)),
    })
}

pub(super) fn open_duckdb_connection(
    connection: &ResolvedConnectionProfile,
) -> Result<Connection, CommandError> {
    let path = duckdb_database_path(connection);
    if path == ":memory:" || path.eq_ignore_ascii_case("memory") {
        Connection::open_in_memory().map_err(duckdb_error)
    } else {
        Connection::open(path).map_err(duckdb_error)
    }
}

pub(super) fn duckdb_database_path(connection: &ResolvedConnectionProfile) -> String {
    connection
        .warehouse_options
        .as_ref()
        .and_then(|options| options.file_path.as_deref())
        .filter(|value| !value.trim().is_empty())
        .or(connection.connection_string.as_deref())
        .map(|value| {
            value
                .strip_prefix("duckdb://")
                .or_else(|| value.strip_prefix("file://"))
                .unwrap_or(value)
        })
        .or(connection.database.as_deref())
        .or_else(|| {
            let host = connection.host.trim();
            (!host.is_empty()).then_some(host)
        })
        .unwrap_or(":memory:")
        .to_string()
}

#[cfg(test)]
fn duckdb_extensions(connection: &ResolvedConnectionProfile) -> Vec<String> {
    connection
        .warehouse_options
        .as_ref()
        .map(|options| {
            options
                .extensions
                .iter()
                .filter(|extension| !extension.trim().is_empty())
                .cloned()
                .collect()
        })
        .unwrap_or_default()
}

pub(super) fn duckdb_error(error: duckdb::Error) -> CommandError {
    CommandError::new("duckdb-error", error.to_string())
}

pub(super) fn duckdb_value_to_string(value: ValueRef<'_>) -> String {
    match value {
        ValueRef::Null => String::new(),
        ValueRef::Boolean(value) => value.to_string(),
        ValueRef::TinyInt(value) => value.to_string(),
        ValueRef::SmallInt(value) => value.to_string(),
        ValueRef::Int(value) => value.to_string(),
        ValueRef::BigInt(value) => value.to_string(),
        ValueRef::HugeInt(value) => value.to_string(),
        ValueRef::UTinyInt(value) => value.to_string(),
        ValueRef::USmallInt(value) => value.to_string(),
        ValueRef::UInt(value) => value.to_string(),
        ValueRef::UBigInt(value) => value.to_string(),
        ValueRef::Float(value) => value.to_string(),
        ValueRef::Double(value) => value.to_string(),
        ValueRef::Decimal(value) => value.to_string(),
        ValueRef::Timestamp(unit, value) => format!("{value:?} {unit:?}"),
        ValueRef::Text(value) => String::from_utf8_lossy(value).to_string(),
        ValueRef::Blob(value) => format!("<{} bytes>", value.len()),
        ValueRef::Date32(value) => value.to_string(),
        ValueRef::Time64(unit, value) => format!("{value:?} {unit:?}"),
        ValueRef::Interval {
            months,
            days,
            nanos,
        } => format!("{months} months {days} days {nanos} ns"),
        other => format!("{other:?}"),
    }
}

pub(crate) fn duckdb_quote_identifier(identifier: &str) -> String {
    format!("\"{}\"", identifier.replace('"', "\"\""))
}

#[cfg(test)]
mod tests {
    use super::{duckdb_database_path, duckdb_quote_identifier};
    use crate::domain::models::ResolvedConnectionProfile;

    #[test]
    fn duckdb_database_path_uses_connection_string() {
        let connection = ResolvedConnectionProfile {
            id: "conn-duckdb".into(),
            name: "DuckDB".into(),
            engine: "duckdb".into(),
            family: "embedded-olap".into(),
            host: String::new(),
            port: None,
            database: Some("ignored.duckdb".into()),
            username: None,
            password: None,
            connection_string: Some("duckdb://:memory:".into()),
            redis_options: None,
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
            read_only: true,
        };

        assert_eq!(duckdb_database_path(&connection), ":memory:");
    }

    #[test]
    fn duckdb_database_path_prefers_warehouse_file_path() {
        let connection = ResolvedConnectionProfile {
            id: "conn-duckdb".into(),
            name: "DuckDB".into(),
            engine: "duckdb".into(),
            family: "embedded-olap".into(),
            host: String::new(),
            port: None,
            database: Some("ignored.duckdb".into()),
            username: None,
            password: None,
            connection_string: Some("duckdb://other.duckdb".into()),
            redis_options: None,
            sqlite_options: None,
            sqlserver_options: None,
            oracle_options: None,
            dynamo_db_options: None,
            cassandra_options: None,
            cosmos_db_options: None,
            search_options: None,
            time_series_options: None,
            graph_options: None,
            warehouse_options: Some(crate::domain::models::WarehouseConnectionOptions {
                file_path: Some("duckdb://C:/data/analytics.duckdb".into()),
                extensions: vec!["httpfs".into(), "parquet".into()],
                ..crate::domain::models::WarehouseConnectionOptions::default()
            }),
            read_only: true,
        };

        assert_eq!(
            duckdb_database_path(&connection),
            "C:/data/analytics.duckdb"
        );
        assert_eq!(
            super::duckdb_extensions(&connection),
            vec!["httpfs", "parquet"]
        );
    }

    #[test]
    fn duckdb_quote_identifier_escapes_quotes() {
        assert_eq!(duckdb_quote_identifier("odd\"table"), "\"odd\"\"table\"");
    }
}
