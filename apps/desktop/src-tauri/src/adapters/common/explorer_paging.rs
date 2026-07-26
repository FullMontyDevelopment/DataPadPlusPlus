use crate::domain::{
    error::CommandError,
    models::{ExplorerPageInfo, ExplorerRequest, ExplorerResponse},
};

const CURSOR_VERSION: &str = "explorer-v1";
const MAX_GENERIC_FETCH: usize = 5_000;

pub(crate) fn prepare_default_explorer_request(
    engine: &str,
    request: &ExplorerRequest,
) -> Result<ExplorerRequest, CommandError> {
    let page_size = usize::try_from(request.limit.unwrap_or(100).clamp(1, 100)).unwrap_or(100);
    let scope_hash = stable_scope_hash(
        engine,
        &request.environment_id,
        request.scope.as_deref().unwrap_or_default(),
    );
    let offset = match request.cursor.as_deref() {
        Some(cursor) => parse_cursor(cursor, scope_hash)?,
        None => 0,
    };
    let mut fetch_request = request.clone();
    fetch_request.cursor = None;
    fetch_request.limit = Some(
        u32::try_from(offset.saturating_add(page_size).min(MAX_GENERIC_FETCH))
            .unwrap_or(MAX_GENERIC_FETCH as u32),
    );
    Ok(fetch_request)
}

pub(crate) fn apply_default_explorer_paging(
    engine: &str,
    request: &ExplorerRequest,
    mut response: ExplorerResponse,
) -> Result<ExplorerResponse, CommandError> {
    if response.page_info.is_some() {
        return Ok(response);
    }

    let page_size = usize::try_from(request.limit.unwrap_or(100).clamp(1, 100)).unwrap_or(100);
    let scope_hash = stable_scope_hash(
        engine,
        &request.environment_id,
        request.scope.as_deref().unwrap_or_default(),
    );
    let offset = match request.cursor.as_deref() {
        Some(cursor) => parse_cursor(cursor, scope_hash)?,
        None => 0,
    };
    let fetched_count = response.nodes.len();
    let requested_fetch = offset.saturating_add(page_size).min(MAX_GENERIC_FETCH);
    let page = response
        .nodes
        .into_iter()
        .skip(offset)
        .take(page_size)
        .collect::<Vec<_>>();
    let next_offset = offset.saturating_add(page.len());
    let fully_enumerated = fetched_count < requested_fetch || page.len() < page_size;
    let has_more = if fully_enumerated {
        next_offset < fetched_count
    } else {
        page.len() == page_size && next_offset < MAX_GENERIC_FETCH
    };

    response.nodes = page;
    response.page_info = Some(ExplorerPageInfo {
        cursor: request.cursor.clone(),
        next_cursor: has_more.then(|| encode_cursor(scope_hash, next_offset)),
        returned_count: u32::try_from(next_offset.saturating_sub(offset)).unwrap_or(u32::MAX),
        known_total: fully_enumerated.then(|| u32::try_from(fetched_count).unwrap_or(u32::MAX)),
        has_more,
    });
    Ok(response)
}

fn parse_cursor(cursor: &str, expected_scope_hash: u64) -> Result<usize, CommandError> {
    let mut parts = cursor.split(':');
    let valid_version = parts.next() == Some(CURSOR_VERSION);
    let scope_hash = parts
        .next()
        .and_then(|value| u64::from_str_radix(value, 16).ok());
    let offset = parts.next().and_then(|value| value.parse::<usize>().ok());

    if !valid_version
        || scope_hash != Some(expected_scope_hash)
        || offset.is_none()
        || parts.next().is_some()
    {
        return Err(CommandError::new(
            "invalid-explorer-cursor",
            "The Explorer cursor is malformed or belongs to another datastore, environment, or scope.",
        ));
    }

    Ok(offset.unwrap_or_default())
}

fn encode_cursor(scope_hash: u64, offset: usize) -> String {
    format!("{CURSOR_VERSION}:{scope_hash:016x}:{offset}")
}

fn stable_scope_hash(engine: &str, environment_id: &str, scope: &str) -> u64 {
    [engine, environment_id, scope]
        .join("\u{1f}")
        .as_bytes()
        .iter()
        .fold(0xcbf29ce484222325, |hash, byte| {
            (hash ^ u64::from(*byte)).wrapping_mul(0x100000001b3)
        })
}

#[cfg(test)]
#[path = "../../../tests/unit/adapters/common/explorer_paging_tests.rs"]
mod tests;
