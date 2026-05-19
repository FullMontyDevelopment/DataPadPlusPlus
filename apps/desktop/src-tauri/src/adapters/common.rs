use std::time::Instant;

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
mod structure;
mod tree_manifest;

pub(crate) use capabilities::*;
pub(crate) use operations::*;
pub(crate) use paging::*;
pub(crate) use payloads::*;
pub(crate) use results::*;
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
    if request.execution_input_mode.as_deref() == Some("script") {
        if execute_mode(request) == "selection" {
            return request
                .selected_text
                .as_deref()
                .filter(|value| !value.trim().is_empty())
                .or(request.script_text.as_deref())
                .unwrap_or(request.query_text.as_str());
        }

        return request
            .script_text
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or(request.query_text.as_str());
    }

    if execute_mode(request) == "selection" {
        request
            .selected_text
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or(request.query_text.as_str())
    } else {
        request.query_text.as_str()
    }
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
