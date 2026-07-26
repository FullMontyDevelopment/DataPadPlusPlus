use crate::domain::{
    error::CommandError,
    models::{ExplorerNode, ExplorerPageInfo},
};

const CURSOR_VERSION: &str = "mongodb-explorer-v1";

pub(super) struct MongoExplorerPaging {
    request_cursor: Option<String>,
    offset: usize,
    limit: usize,
    scope_hash: u64,
}

impl MongoExplorerPaging {
    pub fn new(
        scope: Option<&str>,
        cursor: Option<&str>,
        limit: usize,
    ) -> Result<Self, CommandError> {
        let scope_hash = stable_scope_hash(scope.unwrap_or_default());
        let offset = match cursor {
            Some(cursor) => parse_cursor(cursor, scope_hash)?,
            None => 0,
        };

        Ok(Self {
            request_cursor: cursor.map(str::to_string),
            offset,
            limit,
            scope_hash,
        })
    }

    pub fn finish(self, nodes: Vec<ExplorerNode>) -> (Vec<ExplorerNode>, ExplorerPageInfo) {
        let known_total = nodes.len();
        let page = nodes
            .into_iter()
            .skip(self.offset)
            .take(self.limit)
            .collect::<Vec<_>>();
        let next_offset = self.offset.saturating_add(page.len());
        let has_more = next_offset < known_total;

        (
            page,
            ExplorerPageInfo {
                cursor: self.request_cursor,
                next_cursor: has_more.then(|| encode_cursor(self.scope_hash, next_offset)),
                returned_count: u32::try_from(next_offset.saturating_sub(self.offset))
                    .unwrap_or(u32::MAX),
                known_total: Some(u32::try_from(known_total).unwrap_or(u32::MAX)),
                has_more,
            },
        )
    }
}

fn parse_cursor(cursor: &str, expected_scope_hash: u64) -> Result<usize, CommandError> {
    let mut parts = cursor.split(':');
    let valid_version = parts.next() == Some(CURSOR_VERSION);
    let scope_hash = parts
        .next()
        .and_then(|value| u64::from_str_radix(value, 16).ok());
    let offset = parts.next().and_then(|value| value.parse::<usize>().ok());
    let has_extra_parts = parts.next().is_some();

    if !valid_version
        || scope_hash != Some(expected_scope_hash)
        || offset.is_none()
        || has_extra_parts
    {
        return Err(CommandError::new(
            "invalid-explorer-cursor",
            "The MongoDB Explorer cursor is malformed or belongs to a different scope.",
        ));
    }

    Ok(offset.unwrap_or_default())
}

fn encode_cursor(scope_hash: u64, offset: usize) -> String {
    format!("{CURSOR_VERSION}:{scope_hash:016x}:{offset}")
}

fn stable_scope_hash(scope: &str) -> u64 {
    scope
        .as_bytes()
        .iter()
        .fold(0xcbf29ce484222325, |hash, byte| {
            (hash ^ u64::from(*byte)).wrapping_mul(0x100000001b3)
        })
}

#[cfg(test)]
#[path = "../../../../tests/unit/adapters/datastores/mongodb/explorer_paging_tests.rs"]
mod tests;
