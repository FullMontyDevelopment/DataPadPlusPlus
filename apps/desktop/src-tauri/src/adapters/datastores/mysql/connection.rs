use std::time::Duration;

use crate::domain::models::MySqlConnectionOptions;
use sqlx::{
    mysql::{MySqlPool, MySqlPoolOptions},
    types::chrono::{NaiveDate, NaiveDateTime, NaiveTime},
    Column, Row, TypeInfo,
};

use super::super::super::*;

pub(super) fn stringify_mysql_cell(row: &sqlx::mysql::MySqlRow, index: usize) -> String {
    stringify_sqlx_common(
        [
            row.try_get::<Option<String>, _>(index).ok().flatten(),
            row.try_get::<Option<NaiveDateTime>, _>(index)
                .ok()
                .flatten()
                .map(format_native_date_time),
            row.try_get::<Option<NaiveDate>, _>(index)
                .ok()
                .flatten()
                .map(format_native_date),
            row.try_get::<Option<NaiveTime>, _>(index)
                .ok()
                .flatten()
                .map(format_native_time),
            row.try_get::<Option<bool>, _>(index)
                .ok()
                .flatten()
                .map(|item| item.to_string()),
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
            row.try_get::<Option<Vec<u8>>, _>(index)
                .ok()
                .flatten()
                .map(|item| format!("<{} bytes>", item.len())),
        ],
        format!("<{}>", row.columns()[index].type_info().name()),
    )
}

fn stringify_sqlx_common<const N: usize>(
    candidates: [Option<String>; N],
    fallback: String,
) -> String {
    candidates.into_iter().flatten().next().unwrap_or(fallback)
}

pub(super) fn mysql_dsn(connection: &ResolvedConnectionProfile) -> String {
    connection.connection_string.clone().unwrap_or_else(|| {
        let username = percent_encode_mysql_uri_component(
            &connection.username.clone().unwrap_or_else(|| "root".into()),
        );
        let password =
            percent_encode_mysql_uri_component(&connection.password.clone().unwrap_or_default());
        let database =
            percent_encode_mysql_uri_component(&connection.database.clone().unwrap_or_default());
        format!(
            "mysql://{}:{}@{}:{}/{}{}",
            username,
            password,
            connection.host,
            connection.port.unwrap_or(3306),
            database,
            mysql_dsn_query(connection)
        )
    })
}

pub(super) async fn mysql_pool(
    connection: &ResolvedConnectionProfile,
    max_connections: u32,
) -> Result<MySqlPool, CommandError> {
    let mut options = MySqlPoolOptions::new().max_connections(max_connections);
    if let Some(timeout_ms) = mysql_timeout_ms(connection) {
        options = options.acquire_timeout(Duration::from_millis(timeout_ms));
    }
    Ok(options.connect(&mysql_dsn(connection)).await?)
}

fn mysql_dsn_query(connection: &ResolvedConnectionProfile) -> String {
    let Some(options) = &connection.mysql_options else {
        return String::new();
    };

    let mut pairs = Vec::new();
    if let Some(ssl_mode) = mysql_ssl_mode(options) {
        pairs.push(("ssl-mode".to_string(), ssl_mode));
    }
    push_trimmed_pair(&mut pairs, "ssl-ca", options.ca_certificate_path.as_deref());
    push_trimmed_pair(
        &mut pairs,
        "ssl-cert",
        options.client_certificate_path.as_deref(),
    );
    push_trimmed_pair(&mut pairs, "ssl-key", options.client_key_path.as_deref());
    push_trimmed_pair(&mut pairs, "charset", options.charset.as_deref());
    push_trimmed_pair(&mut pairs, "collation", options.collation.as_deref());
    push_trimmed_pair(&mut pairs, "timezone", options.time_zone.as_deref());
    if let Some(capacity) = options.statement_cache_capacity {
        pairs.push(("statement-cache-capacity".to_string(), capacity.to_string()));
    }
    if let Some(socket) = mysql_socket_path(options) {
        pairs.push(("socket".to_string(), socket));
    }

    if pairs.is_empty() {
        String::new()
    } else {
        let encoded = pairs
            .into_iter()
            .map(|(key, value)| {
                format!(
                    "{}={}",
                    percent_encode_mysql_uri_component(&key),
                    percent_encode_mysql_uri_component(&value)
                )
            })
            .collect::<Vec<_>>()
            .join("&");
        format!("?{encoded}")
    }
}

fn mysql_ssl_mode(options: &MySqlConnectionOptions) -> Option<String> {
    match options.ssl_mode.as_deref() {
        Some("disabled") => Some("DISABLED".into()),
        Some("preferred") => Some("PREFERRED".into()),
        Some("required") => Some("REQUIRED".into()),
        Some("verify-ca") => Some("VERIFY_CA".into()),
        Some("verify-identity") => Some("VERIFY_IDENTITY".into()),
        _ => None,
    }
}

fn mysql_socket_path(options: &MySqlConnectionOptions) -> Option<String> {
    match options.connect_mode.as_deref() {
        Some("unix-socket") => options
            .unix_socket_path
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string),
        Some("cloud-sql-proxy") => options
            .cloud_sql_instance
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(|instance| format!("/cloudsql/{instance}")),
        _ => None,
    }
}

fn mysql_timeout_ms(connection: &ResolvedConnectionProfile) -> Option<u64> {
    connection.mysql_options.as_ref().and_then(|options| {
        options
            .connect_timeout_ms
            .or(options.command_timeout_ms)
            .map(|value| value.clamp(1_000, 120_000))
    })
}

fn push_trimmed_pair(pairs: &mut Vec<(String, String)>, key: &str, value: Option<&str>) {
    if let Some(value) = value.map(str::trim).filter(|value| !value.is_empty()) {
        pairs.push((key.to_string(), value.to_string()));
    }
}

fn percent_encode_mysql_uri_component(value: &str) -> String {
    value
        .bytes()
        .flat_map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                vec![byte as char]
            }
            _ => format!("%{byte:02X}").chars().collect(),
        })
        .collect()
}

pub(super) async fn test_mysql_connection(
    connection: &ResolvedConnectionProfile,
) -> Result<ConnectionTestResult, CommandError> {
    let started = Instant::now();
    let pool = mysql_pool(connection, 1).await?;
    let _: i64 = sqlx::query_scalar("select 1").fetch_one(&pool).await?;
    pool.close().await;

    Ok(ConnectionTestResult {
        ok: true,
        engine: connection.engine.clone(),
        message: format!("Connection test succeeded for {}.", connection.name),
        warnings: Vec::new(),
        resolved_host: connection.host.clone(),
        resolved_database: connection.database.clone(),
        duration_ms: Some(duration_ms(started)),
    })
}

#[cfg(test)]
#[path = "../../../../tests/unit/adapters/datastores/mysql/connection_tests.rs"]
mod tests;
