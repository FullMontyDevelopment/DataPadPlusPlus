use serde_json::json;

use super::{prometheus_profile_payload, NormalizedPrometheusResult, PrometheusQueryRequest};

#[test]
fn prometheus_profile_uses_the_shared_profile_stage_contract() {
    let request = PrometheusQueryRequest {
        kind: "range",
        path: "/api/v1/query_range?query=up".into(),
        raw_query: "up".into(),
    };
    let normalized = NormalizedPrometheusResult {
        rows: vec![vec!["up".into(), "1".into(), "1".into()]],
        series: json!([]),
        total_samples: 2,
        series_count: 1,
        truncated: true,
    };

    let profile = prometheus_profile_payload(&request, "matrix", &normalized, 1, 24);

    assert_eq!(profile["stages"][0]["name"], "request");
    assert_eq!(profile["stages"][0]["durationMs"], 24);
    assert_eq!(profile["stages"][0]["details"]["kind"], "range");
    assert_eq!(profile["stages"][1]["name"], "result");
    assert_eq!(profile["stages"][1]["rows"], 1);
    assert_eq!(profile["stages"][2]["name"], "cardinality");
}
