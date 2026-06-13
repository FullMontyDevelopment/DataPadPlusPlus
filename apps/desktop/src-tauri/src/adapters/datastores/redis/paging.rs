use super::super::super::*;
use super::connection::redis_connection;

pub(crate) async fn fetch_redis_page(
    connection: &ResolvedConnectionProfile,
    request: &ResultPageRequest,
) -> Result<ResultPageResponse, CommandError> {
    let page_size = bounded_page_size(request.page_size);
    let page_index = request.page_index.unwrap_or_default();
    let cursor = request
        .cursor
        .as_deref()
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or_default();
    let line = selected_page_query(request);
    let parts = line.split_whitespace().collect::<Vec<&str>>();
    let pattern = parts
        .windows(2)
        .find(|window| window[0].eq_ignore_ascii_case("MATCH"))
        .map(|window| window[1])
        .unwrap_or("*");
    let mut redis = redis_connection(connection).await?;
    let (next_cursor, keys): (u64, Vec<String>) = redis::cmd("SCAN")
        .arg(cursor)
        .arg("MATCH")
        .arg(pattern)
        .arg("COUNT")
        .arg(page_size)
        .query_async(&mut redis)
        .await?;
    let page_keys = bounded_redis_page_keys(keys, page_size, next_cursor);

    Ok(page_response(
        request,
        payload_table(
            vec!["key".into()],
            page_keys.keys.into_iter().map(|key| vec![key]).collect(),
        ),
        PageResponseInput {
            page_size,
            page_index: page_index + 1,
            buffered_rows: page_keys.buffered_rows,
            has_more: page_keys.has_more,
            next_cursor: page_keys.next_cursor,
            notices: Vec::new(),
        },
    ))
}

struct BoundedRedisPageKeys {
    keys: Vec<String>,
    buffered_rows: u32,
    has_more: bool,
    next_cursor: Option<String>,
}

fn bounded_redis_page_keys(
    keys: Vec<String>,
    page_size: u32,
    next_cursor: u64,
) -> BoundedRedisPageKeys {
    let bounded = bounded_items(keys, page_size);
    let keys = bounded.visible;
    let has_more = next_cursor != 0;

    BoundedRedisPageKeys {
        buffered_rows: keys.len() as u32,
        keys,
        has_more,
        next_cursor: has_more.then(|| next_cursor.to_string()),
    }
}

#[cfg(test)]
#[path = "../../../../tests/unit/adapters/datastores/redis/paging_tests.rs"]
mod tests;
