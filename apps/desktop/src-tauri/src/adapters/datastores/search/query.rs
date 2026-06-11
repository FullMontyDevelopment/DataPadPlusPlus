use serde_json::{json, Value};

use super::super::super::*;
use super::connection::search_post_json;
use super::SearchEngine;

pub(super) async fn execute_search_query(
    engine: SearchEngine,
    adapter: &dyn DatastoreAdapter,
    connection: &ResolvedConnectionProfile,
    request: &ExecutionRequest,
    notices: Vec<QueryExecutionNotice>,
) -> Result<ExecutionResultEnvelope, CommandError> {
    let started = Instant::now();
    let query_text = selected_query(request).trim();
    if query_text.is_empty() {
        return Err(CommandError::new(
            "search-query-missing",
            "No Query DSL JSON was provided.",
        ));
    }

    let row_limit = bounded_page_size(
        request
            .row_limit
            .or(Some(adapter.execution_capabilities().default_row_limit)),
    );
    let query = parse_search_query(
        query_text,
        connection
            .search_options
            .as_ref()
            .and_then(|options| options.default_index.as_deref())
            .or(connection.database.as_deref()),
        row_limit,
        matches!(execute_mode(request), "explain" | "profile"),
    )?;
    let path = format!("/{}/_search", search_index_path_segment(&query.index)?);
    let response = search_post_json(connection, &path, &query.body).await?;
    let value: Value = serde_json::from_str(&response.body).map_err(|error| {
        CommandError::new(
            "search-json-invalid",
            format!("Search engine returned invalid JSON: {error}"),
        )
    })?;
    let normalized = normalize_search_response_bounded(&value, row_limit);
    let total = normalized.total;
    let hits = normalized.hits;
    let aggregations = normalized.aggregations;
    let rows = normalized.rows;
    let truncated = normalized.truncated;
    let response_payload = bounded_search_response(value, row_limit, truncated);
    let profile_payload = search_profile_payload(&query.index, &response_payload);
    let mut payloads = vec![
        payload_search_hits(total, hits.clone(), aggregations.clone()),
        payload_table(
            vec![
                "_index".into(),
                "_id".into(),
                "_score".into(),
                "_source".into(),
            ],
            rows,
        ),
        payload_json(response_payload),
    ];
    if let Some(profile) = profile_payload {
        payloads.push(profile);
    }
    payloads.push(payload_raw(query.body));
    let (default_renderer, renderer_modes_owned) = renderer_modes_for_payloads(&payloads);
    let renderer_modes = renderer_modes_owned
        .iter()
        .map(String::as_str)
        .collect::<Vec<&str>>();

    Ok(build_result(ResultEnvelopeInput {
        engine: &connection.engine,
        summary: if truncated {
            format!(
                "{} search loaded the first {} of {total} hit(s).",
                engine.label, row_limit
            )
        } else {
            format!("{} search returned {total} total hit(s).", engine.label)
        },
        default_renderer: &default_renderer,
        renderer_modes,
        payloads,
        notices,
        duration_ms: duration_ms(started),
        row_limit: Some(row_limit),
        truncated,
        explain_payload: None,
    }))
}

pub(crate) struct SearchQuery {
    pub(crate) index: String,
    pub(crate) body: String,
}

pub(crate) fn parse_search_query(
    query_text: &str,
    default_index: Option<&str>,
    row_limit: u32,
    profile: bool,
) -> Result<SearchQuery, CommandError> {
    let value: Value = serde_json::from_str(query_text).map_err(|error| {
        CommandError::new(
            "search-query-json-invalid",
            format!("Search Query DSL must be JSON: {error}"),
        )
    })?;
    let index = value
        .get("index")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .or(default_index.filter(|value| !value.trim().is_empty()))
        .unwrap_or("_all")
        .to_string();
    let mut body = value.get("body").cloned().unwrap_or(value);
    apply_search_query_runtime_options(&mut body, row_limit, profile);
    let body = serde_json::to_string(&body).map_err(|error| {
        CommandError::new(
            "search-query-json-invalid",
            format!("Search Query DSL could not be normalized: {error}"),
        )
    })?;

    Ok(SearchQuery { index, body })
}

fn apply_search_query_runtime_options(body: &mut Value, row_limit: u32, profile: bool) {
    let fetch_limit = row_limit.saturating_add(1);
    let Some(object) = body.as_object_mut() else {
        return;
    };

    let requested_size = object
        .get("size")
        .and_then(Value::as_u64)
        .unwrap_or(u64::from(fetch_limit));
    object.insert(
        "size".into(),
        json!(requested_size.min(u64::from(fetch_limit))),
    );
    if profile {
        object.insert("profile".into(), json!(true));
    }
}

pub(crate) struct SearchNormalizedResponse {
    pub total: u64,
    pub hits: Value,
    pub aggregations: Value,
    pub rows: Vec<Vec<String>>,
    pub truncated: bool,
}

pub(crate) fn normalize_search_response_bounded(
    value: &Value,
    row_limit: u32,
) -> SearchNormalizedResponse {
    let total = value
        .pointer("/hits/total/value")
        .and_then(Value::as_u64)
        .or_else(|| value.pointer("/hits/total").and_then(Value::as_u64))
        .unwrap_or(0);
    let hits = value
        .pointer("/hits/hits")
        .cloned()
        .unwrap_or_else(|| json!([]));
    let source_hits = hits.as_array().cloned().unwrap_or_default();
    let truncated = source_hits.len() > row_limit as usize;
    let hits = Value::Array(
        source_hits
            .into_iter()
            .take(row_limit as usize)
            .collect::<Vec<Value>>(),
    );
    let aggregations = value
        .get("aggregations")
        .cloned()
        .unwrap_or_else(|| json!({}));
    let rows = hits
        .as_array()
        .into_iter()
        .flatten()
        .map(|hit| {
            vec![
                hit.get("_index")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .into(),
                hit.get("_id")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .into(),
                hit.get("_score").map(Value::to_string).unwrap_or_default(),
                hit.get("_source").map(Value::to_string).unwrap_or_default(),
            ]
        })
        .collect();

    SearchNormalizedResponse {
        total,
        hits,
        aggregations,
        rows,
        truncated,
    }
}

fn bounded_search_response(mut value: Value, row_limit: u32, truncated: bool) -> Value {
    if let Some(hits) = value
        .pointer("/hits/hits")
        .and_then(Value::as_array)
        .cloned()
    {
        if let Some(root) = value.as_object_mut() {
            if let Some(hits_object) = root.get_mut("hits").and_then(Value::as_object_mut) {
                hits_object.insert(
                    "hits".into(),
                    Value::Array(hits.into_iter().take(row_limit as usize).collect()),
                );
            }
            if truncated {
                root.insert(
                    "datapad".into(),
                    json!({
                        "truncated": true,
                        "note": "Search hits were limited before rendering.",
                    }),
                );
            }
        }
    }
    value
}

fn search_profile_payload(index: &str, response: &Value) -> Option<Value> {
    let profile = response.get("profile")?;
    let stages = search_profile_stages(index, profile);

    Some(payload_profile(
        "Search profile returned by the engine.",
        Value::Array(stages),
    ))
}

fn search_profile_stages(index: &str, profile: &Value) -> Vec<Value> {
    let mut stages = Vec::new();
    for shard in profile
        .get("shards")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let shard_id = shard
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or("unknown-shard");
        for search in shard
            .get("searches")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            if let Some(rewrite_time) = search.get("rewrite_time").and_then(Value::as_u64) {
                if rewrite_time > 0 {
                    stages.push(profile_stage(
                        format!("{shard_id} rewrite"),
                        rewrite_time,
                        json!({
                            "index": index,
                            "shard": shard_id,
                            "phase": "rewrite",
                        }),
                    ));
                }
            }
            for query in search
                .get("query")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
            {
                let query_type = query.get("type").and_then(Value::as_str).unwrap_or("query");
                stages.push(profile_stage(
                    format!("{shard_id} {query_type}"),
                    query
                        .get("time_in_nanos")
                        .and_then(Value::as_u64)
                        .unwrap_or_default(),
                    json!({
                        "index": index,
                        "shard": shard_id,
                        "phase": "query",
                        "description": query.get("description").and_then(Value::as_str),
                        "breakdown": query.get("breakdown").cloned().unwrap_or_else(|| json!({})),
                    }),
                ));
            }
            for collector in search
                .get("collector")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
            {
                let collector_name = collector
                    .get("name")
                    .or_else(|| collector.get("reason"))
                    .and_then(Value::as_str)
                    .unwrap_or("collector");
                stages.push(profile_stage(
                    format!("{shard_id} {collector_name}"),
                    collector
                        .get("time_in_nanos")
                        .and_then(Value::as_u64)
                        .unwrap_or_default(),
                    json!({
                        "index": index,
                        "shard": shard_id,
                        "phase": "collector",
                        "reason": collector.get("reason").and_then(Value::as_str),
                        "children": collector.get("children").cloned().unwrap_or_else(|| json!([])),
                    }),
                ));
            }
            for aggregation in search
                .get("aggregations")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
            {
                let aggregation_type = aggregation
                    .get("type")
                    .and_then(Value::as_str)
                    .unwrap_or("aggregation");
                stages.push(profile_stage(
                    format!("{shard_id} {aggregation_type}"),
                    aggregation
                        .get("time_in_nanos")
                        .and_then(Value::as_u64)
                        .unwrap_or_default(),
                    json!({
                        "index": index,
                        "shard": shard_id,
                        "phase": "aggregation",
                        "description": aggregation.get("description").and_then(Value::as_str),
                        "breakdown": aggregation.get("breakdown").cloned().unwrap_or_else(|| json!({})),
                    }),
                ));
            }
            if stages.len() >= 50 {
                return stages;
            }
        }
    }

    if stages.is_empty() {
        stages.push(json!({
            "name": "Search profile",
            "durationMs": 0.0,
            "details": {
                "index": index,
                "shardCount": profile.get("shards").and_then(Value::as_array).map(Vec::len).unwrap_or_default(),
                "rawProfile": profile,
            },
        }));
    }

    stages
}

fn profile_stage(name: String, time_in_nanos: u64, details: Value) -> Value {
    json!({
        "name": name,
        "durationMs": (time_in_nanos as f64) / 1_000_000.0,
        "details": details,
    })
}

fn search_index_path_segment(index: &str) -> Result<String, CommandError> {
    if index.contains('\r')
        || index.contains('\n')
        || index.contains('/')
        || index.contains('?')
        || index.contains('#')
    {
        return Err(CommandError::new(
            "search-index-invalid",
            "Search index names and patterns cannot contain path or header control characters.",
        ));
    }
    Ok(index.to_string())
}

#[cfg(test)]
#[path = "../../../../tests/unit/adapters/datastores/search/query_tests.rs"]
mod tests;
