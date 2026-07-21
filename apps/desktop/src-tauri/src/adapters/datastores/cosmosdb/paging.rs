use super::super::super::*;
use super::cancellation;
use super::connection::CosmosDbResponse;
use super::query::{
    cosmosdb_api, cosmosdb_operation, cosmosdb_page_size, execute_read_operation,
    normalize_cosmosdb_response_bounded, parse_request, CosmosDbReadOperationRequest,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use serde::{Deserialize, Serialize};

const COSMOSDB_CURSOR_VERSION: u8 = 1;
const MAX_COSMOSDB_CURSOR_BYTES: usize = 128 * 1024;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CosmosDbPageCursor {
    version: u8,
    continuation: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    session_token: Option<String>,
}

pub(super) async fn fetch_cosmosdb_page(
    connection: &ResolvedConnectionProfile,
    request: &ResultPageRequest,
) -> Result<ResultPageResponse, CommandError> {
    if cosmosdb_api(connection) == "gremlin" {
        return Err(CommandError::new(
            "cosmosdb-gremlin-paging-unsupported",
            "Cosmos DB Gremlin results do not expose NoSQL continuation-token paging.",
        ));
    }
    if !matches!(request.renderer.as_str(), "document" | "table" | "json") {
        return Err(CommandError::new(
            "cosmosdb-page-renderer-unsupported",
            "Switch to Document, Table, or JSON before loading another Cosmos DB result page.",
        ));
    }
    let cursor = decode_cosmosdb_cursor(request.cursor.as_deref().ok_or_else(|| {
        CommandError::new(
            "cosmosdb-continuation-missing",
            "Cosmos DB did not provide a continuation token for the next page.",
        )
    })?)?;
    let request_value = parse_request(selected_page_query(request).trim())?;
    let operation = cosmosdb_operation(&request_value)?;
    if operation != "QueryDocuments" {
        return Err(CommandError::new(
            "cosmosdb-page-operation-unsupported",
            "Continuation-token paging is available for Cosmos DB document queries.",
        ));
    }
    let page_size = cosmosdb_page_size(connection, request.page_size);
    let cancellation = cancellation::register(request.execution_id.as_deref());
    let token = cancellation.token();
    let response = execute_read_operation(
        connection,
        CosmosDbReadOperationRequest {
            execution_mode: None,
            operation: &operation,
            request: &request_value,
            row_limit: page_size,
            continuation: Some(cursor.continuation),
            session_token: cursor.session_token,
            cancellation: Some(&token),
        },
    )
    .await?;
    let response_value = response.json()?;
    let normalized = normalize_cosmosdb_response_bounded(&operation, &response_value, page_size);
    let buffered_rows = normalized.rows.len() as u32;
    let payload = match request.renderer.as_str() {
        "document" => payload_document(normalized.documents),
        "table" => payload_table(normalized.columns, normalized.rows),
        "json" => payload_json(response_value),
        _ => unreachable!("renderer was validated above"),
    };
    let next_cursor = cursor_from_response(&response)?;
    let mut notices = Vec::new();
    if let Some(charge) = response.request_charge {
        notices.push(format!("Cosmos DB result page consumed {charge} RU."));
    }
    if let Some(activity_id) = response.activity_id.as_deref() {
        notices.push(format!("Cosmos DB activity id: {activity_id}."));
    }

    Ok(page_response(
        request,
        payload,
        PageResponseInput {
            page_size,
            page_index: request.page_index.unwrap_or(1),
            buffered_rows,
            has_more: next_cursor.is_some(),
            next_cursor,
            notices,
        },
    ))
}

pub(super) fn apply_cosmosdb_result_paging(
    result: &mut ExecutionResultEnvelope,
    response: &CosmosDbResponse,
    page_size: u32,
) -> Result<(), CommandError> {
    let cursor = cursor_from_response(response)?;
    let has_more = cursor.is_some();
    result.continuation_token = cursor.clone();
    result.truncated = Some(result.truncated.unwrap_or(false) || has_more);
    if let Some(page_info) = result.page_info.as_mut() {
        page_info.page_size = page_size;
        page_info.page_index = 0;
        page_info.has_more = has_more;
        page_info.next_cursor = cursor;
    }
    Ok(())
}

fn cursor_from_response(response: &CosmosDbResponse) -> Result<Option<String>, CommandError> {
    let Some(continuation) = response
        .continuation
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return Ok(None);
    };
    let cursor = CosmosDbPageCursor {
        version: COSMOSDB_CURSOR_VERSION,
        continuation: continuation.to_string(),
        session_token: response.session_token.clone(),
    };
    let bytes = serde_json::to_vec(&cursor).map_err(|_| invalid_cursor_error())?;
    if bytes.len() > MAX_COSMOSDB_CURSOR_BYTES {
        return Err(CommandError::new(
            "cosmosdb-continuation-too-large",
            "Cosmos DB returned a continuation token that exceeded the paging safety limit.",
        ));
    }
    Ok(Some(URL_SAFE_NO_PAD.encode(bytes)))
}

fn decode_cosmosdb_cursor(value: &str) -> Result<CosmosDbPageCursor, CommandError> {
    if value.is_empty() || value.len() > MAX_COSMOSDB_CURSOR_BYTES * 2 {
        return Err(invalid_cursor_error());
    }
    if let Ok(bytes) = URL_SAFE_NO_PAD.decode(value) {
        if let Ok(cursor) = serde_json::from_slice::<CosmosDbPageCursor>(&bytes) {
            if cursor.version == COSMOSDB_CURSOR_VERSION
                && valid_cursor_header(&cursor.continuation)
                && cursor
                    .session_token
                    .as_deref()
                    .is_none_or(valid_cursor_header)
            {
                return Ok(cursor);
            }
            return Err(invalid_cursor_error());
        }
    }

    // Accept legacy raw continuation tokens produced before cursors became opaque.
    if !valid_cursor_header(value) {
        return Err(invalid_cursor_error());
    }
    Ok(CosmosDbPageCursor {
        version: COSMOSDB_CURSOR_VERSION,
        continuation: value.to_string(),
        session_token: None,
    })
}

fn valid_cursor_header(value: &str) -> bool {
    !value.trim().is_empty()
        && value.len() <= MAX_COSMOSDB_CURSOR_BYTES
        && !value.chars().any(char::is_control)
}

fn invalid_cursor_error() -> CommandError {
    CommandError::new(
        "cosmosdb-continuation-invalid",
        "Cosmos DB continuation state is invalid. Rerun the query to start a new result set.",
    )
}

#[cfg(test)]
#[path = "../../../../tests/unit/adapters/datastores/cosmosdb/paging_tests.rs"]
mod tests;
