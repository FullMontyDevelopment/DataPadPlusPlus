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
        .connection_string
        .as_deref()
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
            read_only: true,
        };

        assert_eq!(duckdb_database_path(&connection), ":memory:");
    }

    #[test]
    fn duckdb_quote_identifier_escapes_quotes() {
        assert_eq!(duckdb_quote_identifier("odd\"table"), "\"odd\"\"table\"");
    }
}
