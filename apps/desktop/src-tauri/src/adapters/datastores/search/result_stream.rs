use super::super::super::*;
use super::connection::{search_delete_json, search_post_json};
use serde_json::{json, Value};

struct ScrollLease {
    connection: ResolvedConnectionProfile,
    id: Option<String>,
}

impl Drop for ScrollLease {
    fn drop(&mut self) {
        if let Some(id) = self.id.take() {
            let connection = self.connection.clone();
            tokio::spawn(async move {
                let _ = search_delete_json(
                    &connection,
                    "/_search/scroll",
                    &json!({"scroll_id": [id]}).to_string(),
                )
                .await;
            });
        }
    }
}

pub(super) async fn stream(
    connection: &ResolvedConnectionProfile,
    request: &ExecutionRequest,
    sink: &mut dyn crate::adapters::result_stream::ResultRowSink,
) -> Result<(), CommandError> {
    crate::adapters::result_stream::validate_read_request(request)?;
    let input: Value = serde_json::from_str(selected_query(request))?;
    let index = input
        .get("index")
        .and_then(Value::as_str)
        .or(connection
            .search_options
            .as_ref()
            .and_then(|options| options.default_index.as_deref()))
        .or(connection.database.as_deref())
        .unwrap_or("_all");
    let mut body = input.get("body").cloned().unwrap_or_else(|| input.clone());
    let object = body.as_object_mut().ok_or_else(|| {
        CommandError::new(
            "result-export-query",
            "Search export requires a Query DSL object.",
        )
    })?;
    object.remove("index");
    let total_limit = object.get("size").and_then(Value::as_u64);
    if total_limit == Some(0)
        || object
            .get("from")
            .and_then(Value::as_u64)
            .is_some_and(|offset| offset != 0)
        || [
            "pit",
            "search_after",
            "collapse",
            "rescore",
            "aggs",
            "aggregations",
            "knn",
        ]
        .iter()
        .any(|key| object.contains_key(*key))
    {
        return Err(CommandError::new("result-export-unsupported", "Full search export supports ordinary hit queries without offsets, aggregations, collapse, rescore, or an existing cursor. Export loaded results for this query form."));
    }
    let batch = u64::from(bounded_page_size(request.row_limit));
    object.insert(
        "size".into(),
        json!(total_limit.unwrap_or(batch).min(batch)),
    );
    let path = format!(
        "/{}/_search?scroll=1m",
        super::query::search_index_path_segment(index)?
    );
    let mut response = search_post_json(connection, &path, &body.to_string()).await?;
    let mut lease = ScrollLease {
        connection: connection.clone(),
        id: None,
    };
    let mut exported = 0_u64;
    loop {
        let page: Value = serde_json::from_str(&response.body)?;
        if page.get("timed_out").and_then(Value::as_bool) == Some(true)
            || page
                .pointer("/_shards/failed")
                .and_then(Value::as_u64)
                .unwrap_or(0)
                > 0
        {
            return Err(CommandError::new("result-export-partial", "The search server returned a timeout or failed shard. No complete export was published."));
        }
        lease.id = page
            .get("_scroll_id")
            .and_then(Value::as_str)
            .map(str::to_owned);
        let hits = page
            .pointer("/hits/hits")
            .and_then(Value::as_array)
            .ok_or_else(|| {
                CommandError::new(
                    "result-export-response",
                    "The search server returned an unexpected hit response.",
                )
            })?;
        if hits.is_empty() {
            return Ok(());
        }
        for hit in hits {
            if total_limit.is_some_and(|limit| exported >= limit) {
                return Ok(());
            }
            if !sink.row(hit.clone())? {
                return Ok(());
            }
            exported += 1;
        }
        if total_limit.is_some_and(|limit| exported >= limit) {
            return Ok(());
        }
        let id = lease.id.as_ref().ok_or_else(|| {
            CommandError::new(
                "result-export-continuation",
                "The search server did not return a continuation cursor.",
            )
        })?;
        response = search_post_json(
            connection,
            "/_search/scroll",
            &json!({"scroll": "1m", "scroll_id": id}).to_string(),
        )
        .await?;
    }
}
