use serde_json::json;

use super::{
    normalize_search_response_bounded, parse_search_query, search_index_path_segment,
    search_profile_payload, search_profile_stages,
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
                    {
                        "id": "[logs][0]",
                        "searches": [{
                            "rewrite_time": 250000,
                            "query": [{
                                "type": "BooleanQuery",
                                "description": "status:active",
                                "time_in_nanos": 1500000,
                                "breakdown": { "match_count": 3 }
                            }],
                            "collector": [{
                                "name": "SimpleTopScoreDocCollector",
                                "reason": "search_top_hits",
                                "time_in_nanos": 500000
                            }],
                            "aggregations": [{
                                "type": "GlobalAggregator",
                                "description": "status terms",
                                "time_in_nanos": 750000
                            }]
                        }]
                    }
                ]
            }
        }),
    )
    .unwrap();

    assert_eq!(payload["renderer"], "profile");
    assert_eq!(payload["stages"][0]["name"], "[logs][0] rewrite");
    assert_eq!(payload["stages"][1]["name"], "[logs][0] BooleanQuery");
    assert_eq!(payload["stages"][1]["durationMs"], 1.5);
    assert_eq!(
        payload["stages"][1]["details"]["description"],
        "status:active"
    );
    assert_eq!(payload["stages"].as_array().unwrap().len(), 4);
}

#[test]
fn search_profile_stages_falls_back_when_profile_shape_is_empty() {
    let stages = search_profile_stages("logs-*", &json!({ "shards": [] }));

    assert_eq!(stages[0]["name"], "Search profile");
    assert_eq!(stages[0]["details"]["index"], "logs-*");
}
