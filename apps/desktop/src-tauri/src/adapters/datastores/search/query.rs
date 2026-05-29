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

    let query = parse_search_query_with_default(
        query_text,
        connection
            .search_options
            .as_ref()
            .and_then(|options| options.default_index.as_deref())
            .or(connection.database.as_deref()),
    )?;
    let path = format!("/{}/_search", query.index);
    let response = search_post_json(connection, &path, &query.body).await?;
    let value: Value = serde_json::from_str(&response.body).map_err(|error| {
        CommandError::new(
            "search-json-invalid",
            format!("Search engine returned invalid JSON: {error}"),
        )
    })?;
    let (total, hits, aggregations, rows) = normalize_search_response(&value);
    let payloads = vec![
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
        payload_json(value),
        payload_raw(query.body),
    ];
    let (default_renderer, renderer_modes_owned) = renderer_modes_for_payloads(&payloads);
    let renderer_modes = renderer_modes_owned
        .iter()
        .map(String::as_str)
        .collect::<Vec<&str>>();
    let row_limit = bounded_page_size(
        request
            .row_limit
            .or(Some(adapter.execution_capabilities().default_row_limit)),
    );

    Ok(build_result(ResultEnvelopeInput {
        engine: &connection.engine,
        summary: format!("{} search returned {total} total hit(s).", engine.label),
        default_renderer: &default_renderer,
        renderer_modes,
        payloads,
        notices,
        duration_ms: duration_ms(started),
        row_limit: Some(row_limit),
        truncated: false,
        explain_payload: None,
    }))
}

pub(crate) struct SearchQuery {
    pub(crate) index: String,
    pub(crate) body: String,
}

pub(crate) fn parse_search_query_with_default(
    query_text: &str,
    default_index: Option<&str>,
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
    let body = value.get("body").cloned().unwrap_or(value);
    let body = serde_json::to_string(&body).map_err(|error| {
        CommandError::new(
            "search-query-json-invalid",
            format!("Search Query DSL could not be normalized: {error}"),
        )
    })?;

    Ok(SearchQuery { index, body })
}

pub(crate) fn normalize_search_response(value: &Value) -> (u64, Value, Value, Vec<Vec<String>>) {
    let total = value
        .pointer("/hits/total/value")
        .and_then(Value::as_u64)
        .or_else(|| value.pointer("/hits/total").and_then(Value::as_u64))
        .unwrap_or(0);
    let hits = value
        .pointer("/hits/hits")
        .cloned()
        .unwrap_or_else(|| json!([]));
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

    (total, hits, aggregations, rows)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{normalize_search_response, parse_search_query_with_default};

    #[test]
    fn search_query_supports_wrapped_index_and_body() {
        let parsed = parse_search_query_with_default(
            r#"{ "index": "logs-*", "body": { "query": { "match_all": {} } } }"#,
            None,
        )
        .unwrap();

        assert_eq!(parsed.index, "logs-*");
        assert_eq!(parsed.body, r#"{"query":{"match_all":{}}}"#);
    }

    #[test]
    fn search_query_uses_profile_default_index_when_query_omits_it() {
        let parsed = parse_search_query_with_default(
            r#"{ "query": { "match_all": {} } }"#,
            Some("catalog-*"),
        )
        .unwrap();

        assert_eq!(parsed.index, "catalog-*");
        assert_eq!(parsed.body, r#"{"query":{"match_all":{}}}"#);
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
        let (total, hits, aggregations, rows) = normalize_search_response(&value);

        assert_eq!(total, 2);
        assert_eq!(hits.as_array().unwrap().len(), 1);
        assert!(aggregations.get("levels").is_some());
        assert_eq!(rows[0][0], "logs");
    }
}
