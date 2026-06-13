use serde_json::Value;

use crate::domain::{
    error::CommandError,
    models::{ResultPageInfo, ResultPageRequest, ResultPageResponse},
};

use super::*;

pub(crate) fn no_additional_pages_response(
    engine: &str,
    request: &ResultPageRequest,
) -> ResultPageResponse {
    ResultPageResponse {
        tab_id: request.tab_id.clone(),
        result_id: None,
        payload: payload_raw(format!(
            "Additional pages are not available for {engine} preview/read results yet."
        )),
        page_info: ResultPageInfo {
            page_size: bounded_page_size(request.page_size),
            page_index: request.page_index.unwrap_or_default(),
            buffered_rows: 0,
            has_more: false,
            next_cursor: None,
            total_rows_known: None,
        },
        notices: vec![format!(
            "{engine} returned a non-cursor result; rerun the query with a tighter limit to page manually."
        )],
    }
}

pub(crate) struct PageResponseInput {
    pub(crate) page_size: u32,
    pub(crate) page_index: u32,
    pub(crate) buffered_rows: u32,
    pub(crate) has_more: bool,
    pub(crate) next_cursor: Option<String>,
    pub(crate) notices: Vec<String>,
}

pub(crate) fn page_response(
    request: &ResultPageRequest,
    payload: Value,
    input: PageResponseInput,
) -> ResultPageResponse {
    ResultPageResponse {
        tab_id: request.tab_id.clone(),
        result_id: None,
        payload,
        page_info: ResultPageInfo {
            page_size: input.page_size,
            page_index: input.page_index,
            buffered_rows: input.buffered_rows,
            has_more: input.has_more,
            next_cursor: input.next_cursor,
            total_rows_known: None,
        },
        notices: input.notices,
    }
}

pub(crate) fn selected_page_query(request: &ResultPageRequest) -> &str {
    request
        .selected_text
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(request.query_text.as_str())
}

pub(crate) fn is_read_only_select(statement: &str) -> bool {
    let trimmed = statement.trim_start().to_lowercase();
    trimmed.starts_with("select") || trimmed.starts_with("with")
}

pub(crate) fn strip_sql_semicolon(statement: &str) -> String {
    statement.trim().trim_end_matches(';').trim().to_string()
}

pub(crate) fn paged_sql(
    statement: &str,
    page_size: u32,
    page_index: u32,
) -> Result<String, CommandError> {
    if !is_read_only_select(statement) {
        return Err(CommandError::new(
            "result-page-readonly-required",
            "Next-page loading is only available for read-only SELECT or WITH queries.",
        ));
    }

    let offset = u64::from(page_index) * u64::from(page_size);
    Ok(format!(
        "select * from ({}) as datapadplusplus_page limit {} offset {}",
        strip_sql_semicolon(statement),
        page_size.saturating_add(1),
        offset
    ))
}
