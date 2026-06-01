use std::time::Instant;

use chrono::{Duration, NaiveDate, NaiveDateTime, NaiveTime, Timelike};
use serde_json::Value;

use crate::domain::{
    error::CommandError,
    models::{
        ExecutionRequest, QueryExecutionNotice, ResolvedConnectionProfile, ResultPageInfo,
        ResultPageRequest, ResultPageResponse, StructureRequest, StructureResponse,
    },
};

use super::datastores;

mod capabilities;
mod operations;
mod paging;
mod payloads;
mod results;
mod sql_batch;
mod structure;
mod tree_manifest;

pub(crate) use capabilities::*;
pub(crate) use operations::*;
pub(crate) use paging::*;
pub(crate) use payloads::*;
pub(crate) use results::*;
pub(crate) use sql_batch::*;
pub(crate) use structure::*;

pub(crate) fn bounded_page_size(value: Option<u32>) -> u32 {
    value.unwrap_or(DEFAULT_PAGE_SIZE).clamp(1, MAX_PAGE_SIZE)
}

pub(crate) fn sql_literal(value: &str) -> String {
    value.replace('\'', "''")
}

pub(crate) fn execute_mode(request: &ExecutionRequest) -> &str {
    request.mode.as_deref().unwrap_or("full")
}

pub(crate) fn selected_query(request: &ExecutionRequest) -> &str {
    let selected_text = request
        .selected_text
        .as_deref()
        .filter(|value| !value.trim().is_empty());

    if request.execution_input_mode.as_deref() == Some("script") {
        if let Some(selected_text) = selected_text {
            return selected_text;
        }

        return request
            .script_text
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or(request.query_text.as_str());
    }

    selected_text.unwrap_or(request.query_text.as_str())
}

pub(crate) fn duration_ms(started: Instant) -> u64 {
    started.elapsed().as_millis() as u64
}

pub(crate) fn stringify_sql_value<T>(value: Option<T>) -> Option<String>
where
    T: ToString,
{
    value.map(|item| item.to_string())
}

pub(crate) fn stringify_sqlx_common<const N: usize>(
    candidates: [Option<String>; N],
    fallback: String,
) -> String {
    candidates.into_iter().flatten().next().unwrap_or(fallback)
}

pub(crate) fn format_native_date_time(value: NaiveDateTime) -> String {
    format!(
        "{} {}",
        format_native_date(value.date()),
        format_native_time(value.time())
    )
}

pub(crate) fn format_native_date(value: NaiveDate) -> String {
    value.to_string()
}

pub(crate) fn format_native_time(value: NaiveTime) -> String {
    let base = value.format("%H:%M:%S").to_string();
    let nanos = value.nanosecond();

    if nanos == 0 {
        return base;
    }

    let mut fraction = format!("{nanos:09}");
    while fraction.ends_with('0') {
        fraction.pop();
    }

    format!("{base}.{fraction}")
}

pub(crate) fn date_from_days_since(days: i64, start_year: i32) -> Option<NaiveDate> {
    NaiveDate::from_ymd_opt(start_year, 1, 1)?.checked_add_signed(Duration::days(days))
}

pub(crate) fn time_from_nanos_since_midnight(total_nanos: i128) -> Option<NaiveTime> {
    let nanos_per_day = 86_400_i128 * 1_000_000_000_i128;

    if !(0..nanos_per_day).contains(&total_nanos) {
        return None;
    }

    let seconds = total_nanos / 1_000_000_000_i128;
    let nanos = total_nanos % 1_000_000_000_i128;

    NaiveTime::from_num_seconds_from_midnight_opt(seconds as u32, nanos as u32)
}

pub(crate) fn time_from_scaled_increments(increments: u64, scale: u8) -> Option<NaiveTime> {
    if scale > 9 {
        return None;
    }

    let nanos_per_increment = 10_i128.pow(u32::from(9 - scale));
    time_from_nanos_since_midnight(i128::from(increments) * nanos_per_increment)
}

pub(crate) fn renderer_modes_for_payloads(payloads: &[Value]) -> (String, Vec<String>) {
    let modes = payloads
        .iter()
        .filter_map(|payload| payload.get("renderer").and_then(Value::as_str))
        .map(str::to_string)
        .collect::<Vec<String>>();
    let default_renderer = modes.first().cloned().unwrap_or_else(|| "raw".into());
    (default_renderer, modes)
}

pub(crate) fn sql_history_notice(notices: Vec<QueryExecutionNotice>) -> Vec<QueryExecutionNotice> {
    notices
}

pub(crate) async fn load_structure_map_for_connection(
    connection: &ResolvedConnectionProfile,
    request: &StructureRequest,
) -> Result<StructureResponse, CommandError> {
    match connection.engine.as_str() {
        "postgresql" | "cockroachdb" => {
            datastores::postgresql::load_postgres_structure(connection, request).await
        }
        "sqlserver" => datastores::sqlserver::load_sqlserver_structure(connection, request).await,
        "mysql" | "mariadb" => datastores::mysql::load_mysql_structure(connection, request).await,
        "sqlite" => datastores::sqlite::load_sqlite_structure(connection, request).await,
        "mongodb" => datastores::mongodb::load_mongodb_structure(connection, request).await,
        "redis" => datastores::redis::load_redis_structure(connection, request).await,
        _ => Err(CommandError::new(
            "structure-unsupported",
            "Structure visualization is not supported for this adapter.",
        )),
    }
}

pub(crate) async fn fetch_result_page_for_connection(
    connection: &ResolvedConnectionProfile,
    request: &ResultPageRequest,
) -> Result<ResultPageResponse, CommandError> {
    match connection.engine.as_str() {
        "postgresql" | "cockroachdb" => {
            datastores::postgresql::fetch_postgres_page(connection, request).await
        }
        "mysql" | "mariadb" => datastores::mysql::fetch_mysql_page(connection, request).await,
        "sqlite" => datastores::sqlite::fetch_sqlite_page(connection, request).await,
        "mongodb" => datastores::mongodb::fetch_mongodb_page(connection, request).await,
        "redis" => datastores::redis::fetch_redis_page(connection, request).await,
        "sqlserver" => Ok(ResultPageResponse {
            tab_id: request.tab_id.clone(),
            result_id: None,
            payload: payload_raw("Additional SQL Server pages require a safe ordered paging query and are not available for this result.".into()),
            page_info: ResultPageInfo {
                page_size: bounded_page_size(request.page_size),
                page_index: request.page_index.unwrap_or_default(),
                buffered_rows: 0,
                has_more: false,
                next_cursor: None,
                total_rows_known: None,
            },
            notices: vec![
                "SQL Server next-page loading is available only after ordered paging support is enabled.".into(),
            ],
        }),
        _ => Err(CommandError::new(
            "result-page-unsupported",
            "Paged result loading is not supported for this adapter.",
        )),
    }
}
