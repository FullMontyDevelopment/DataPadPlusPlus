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
    let profile = response.get("profile").cloned()?;

    Some(payload_profile(
        "Search profile returned by the engine.",
        json!({
            "index": index,
            "profile": profile,
        }),
    ))
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
mod tests {
    use serde_json::json;

    use super::{
        normalize_search_response_bounded, parse_search_query, search_index_path_segment,
        search_profile_payload,
    };

    #[test]
    fn search_query_supports_wrapped_index_and_body() {
        let parsed = parse_search_query(
            r#"{ "index": "logs-*", "body": { "query": { "match_all": {} } } }"#,
            None,
            500,
            false,
        )
        .unwrap();

        assert_eq!(parsed.index, "logs-*");
        assert_eq!(parsed.body, r#"{"query":{"match_all":{}},"size":501}"#);
    }

    #[test]
    fn search_query_uses_profile_default_index_when_query_omits_it() {
        let parsed = parse_search_query(
            r#"{ "query": { "match_all": {} } }"#,
            Some("catalog-*"),
            500,
            false,
        )
        .unwrap();

        assert_eq!(parsed.index, "catalog-*");
        assert_eq!(parsed.body, r#"{"query":{"match_all":{}},"size":501}"#);
    }

    #[test]
    fn search_query_clamps_size_and_enables_profile_mode() {
        let parsed = parse_search_query(
            r#"{ "index": "logs-*", "body": { "size": 10000, "query": { "match_all": {} } } }"#,
            None,
            100,
            true,
        )
        .unwrap();
        let body: serde_json::Value = serde_json::from_str(&parsed.body).unwrap();

        assert_eq!(body["size"], 101);
        assert_eq!(body["profile"], true);
    }

    #[test]
    fn search_response_normalizes_hits_to_table_rows() {
        let value = json!({
            "hits": {
                "total": { "value": 2 },
                "hits": [
                    { "_index": "logs", "_id": "1", "_score": 1.0, "_source": { "message": "hi" } }
                ]
            },
            "aggregations": { "levels": { "buckets": [] } }
        });
        let normalized = normalize_search_response_bounded(&value, 500);

        assert_eq!(normalized.total, 2);
        assert_eq!(normalized.hits.as_array().unwrap().len(), 1);
        assert!(normalized.aggregations.get("levels").is_some());
        assert_eq!(normalized.rows[0][0], "logs");
    }

    #[test]
    fn search_response_bounded_reports_truncation_without_rendering_extra_hit() {
        let value = json!({
            "hits": {
                "total": { "value": 3 },
                "hits": [
                    { "_index": "logs", "_id": "1", "_score": 1.0, "_source": { "message": "one" } },
                    { "_index": "logs", "_id": "2", "_score": 1.0, "_source": { "message": "two" } },
                    { "_index": "logs", "_id": "3", "_score": 1.0, "_source": { "message": "three" } }
                ]
            }
        });

        let normalized = normalize_search_response_bounded(&value, 2);

        assert!(normalized.truncated);
        assert_eq!(normalized.total, 3);
        assert_eq!(normalized.hits.as_array().unwrap().len(), 2);
        assert_eq!(normalized.rows.len(), 2);
    }

    #[test]
    fn search_index_path_segment_rejects_path_breaking_characters() {
        assert!(search_index_path_segment("logs-*").is_ok());
        assert!(search_index_path_segment("logs/2026").is_err());
        assert!(search_index_path_segment("logs?pretty").is_err());
    }

    #[test]
    fn search_profile_payload_uses_native_root_profile_section() {
        let payload = search_profile_payload(
            "logs-*",
            &json!({
                "profile": {
                    "shards": [
                        { "id": "[logs][0]", "searches": [] }
                    ]
                }
            }),
        )
        .unwrap();

        assert_eq!(payload["renderer"], "profile");
        assert_eq!(payload["stages"]["index"], "logs-*");
        assert_eq!(
            payload["stages"]["profile"]["shards"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
    }
}
