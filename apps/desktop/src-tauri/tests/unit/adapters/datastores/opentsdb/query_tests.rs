use serde_json::json;

use super::{opentsdb_profile_payload, NormalizedOpenTsdbResult, OpenTsdbQueryRequest};

#[test]
fn opentsdb_profile_uses_the_shared_profile_stage_contract() {
    let request = OpenTsdbQueryRequest {
        body: "{}".into(),
        query_count: 2,
        start: Some("1h-ago".into()),
        end: None,
    };
    let normalized = NormalizedOpenTsdbResult {
        rows: vec![vec!["latency".into(), "{}".into(), "1".into(), "3".into()]],
        series: json!([]),
        metric_count: 2,
        total_points: 4,
        truncated: false,
    };

    let profile = opentsdb_profile_payload(&request, &normalized, 100, 12);

    assert_eq!(profile["stages"][0]["name"], "request");
    assert_eq!(profile["stages"][0]["durationMs"], 12);
    assert_eq!(profile["stages"][1]["name"], "result");
    assert_eq!(profile["stages"][1]["rows"], 1);
    assert_eq!(profile["stages"][2]["name"], "cardinality");
}
