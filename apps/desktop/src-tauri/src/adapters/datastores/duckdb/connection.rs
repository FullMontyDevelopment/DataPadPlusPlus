use chrono::{Duration, NaiveDate};
use duckdb::{
    types::{TimeUnit, ValueRef},
    Connection,
};

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
        resolved_database: Some(validated_duckdb_database_path(connection)?),
        duration_ms: Some(duration_ms(started)),
    })
}

pub(super) fn open_duckdb_connection(
    connection: &ResolvedConnectionProfile,
) -> Result<Connection, CommandError> {
    let path = validated_duckdb_database_path(connection)?;
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

fn validated_duckdb_database_path(
    connection: &ResolvedConnectionProfile,
) -> Result<String, CommandError> {
    let path = duckdb_database_path(connection);
    validate_duckdb_database_path(&path)?;
    Ok(path)
}

fn validate_duckdb_database_path(path: &str) -> Result<(), CommandError> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err(CommandError::new(
            "duckdb-path-missing",
            "DuckDB requires a database file path or :memory:.",
        ));
    }
    if trimmed.chars().any(char::is_control) {
        return Err(CommandError::new(
            "duckdb-path-invalid",
            "DuckDB database path contains an invalid control character.",
        ));
    }
    if trimmed.contains("://")
        && !trimmed.starts_with("duckdb://")
        && !trimmed.starts_with("file://")
    {
        return Err(CommandError::new(
            "duckdb-path-unsupported",
            "DuckDB database paths must be local files, duckdb:// paths, file:// paths, or :memory:.",
        ));
    }
    Ok(())
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
        ValueRef::Timestamp(unit, value) => format_duckdb_timestamp(unit, value),
        ValueRef::Text(value) => String::from_utf8_lossy(value).to_string(),
        ValueRef::Blob(value) => format!("<{} bytes>", value.len()),
        ValueRef::Date32(value) => date_from_days_since(i64::from(value), 1970)
            .map(format_native_date)
            .unwrap_or_else(|| value.to_string()),
        ValueRef::Time64(unit, value) => duckdb_unit_to_nanos(unit, value)
            .and_then(time_from_nanos_since_midnight)
            .map(format_native_time)
            .unwrap_or_else(|| value.to_string()),
        ValueRef::Interval {
            months,
            days,
            nanos,
        } => format!("{months} months {days} days {nanos} ns"),
        other => format!("{other:?}"),
    }
}

fn format_duckdb_timestamp(unit: TimeUnit, value: i64) -> String {
    duckdb_unit_to_nanos(unit, value)
        .and_then(|nanos| {
            let base = NaiveDate::from_ymd_opt(1970, 1, 1)?.and_hms_nano_opt(0, 0, 0, 0)?;
            let seconds = nanos.div_euclid(1_000_000_000_i128);
            let remainder = nanos.rem_euclid(1_000_000_000_i128);
            base.checked_add_signed(Duration::seconds(seconds as i64))?
                .checked_add_signed(Duration::nanoseconds(remainder as i64))
        })
        .map(format_native_date_time)
        .unwrap_or_else(|| value.to_string())
}

fn duckdb_unit_to_nanos(unit: TimeUnit, value: i64) -> Option<i128> {
    let multiplier = match unit {
        TimeUnit::Second => 1_000_000_000_i128,
        TimeUnit::Millisecond => 1_000_000_i128,
        TimeUnit::Microsecond => 1_000_i128,
        TimeUnit::Nanosecond => 1_i128,
    };

    i128::from(value).checked_mul(multiplier)
}

pub(crate) fn duckdb_quote_identifier(identifier: &str) -> String {
    format!("\"{}\"", identifier.replace('"', "\"\""))
}

#[cfg(test)]
#[path = "../../../../tests/unit/adapters/datastores/duckdb/connection_tests.rs"]
mod tests;
