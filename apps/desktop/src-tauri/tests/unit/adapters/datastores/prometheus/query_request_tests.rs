use super::prometheus_query_request;

#[test]
fn prometheus_selectors_that_start_with_braces_stay_raw_promql() {
    let request = prometheus_query_request(r#"{__name__!="",job="api"}"#).unwrap();

    assert_eq!(request.kind, "instant");
    assert!(request.path.starts_with("/api/v1/query?query=%7B__name__"));
}

#[test]
fn prometheus_structured_range_query_builds_query_range_path() {
    let request = prometheus_query_request(
        r#"{
            "mode": "range",
            "query": "rate(http_requests_total[5m])",
            "start": "2026-05-31T10:00:00Z",
            "end": "2026-05-31T11:00:00Z",
            "step": "60s",
            "timeout": "30s"
        }"#,
    )
    .unwrap();

    assert_eq!(request.kind, "range");
    assert!(request.path.starts_with("/api/v1/query_range?"));
    assert!(request.path.contains("query=rate%28http_requests_total"));
    assert!(request.path.contains("step=60s"));
    assert!(request.path.contains("timeout=30s"));
}

#[test]
fn prometheus_structured_range_query_requires_range_fields() {
    let error = prometheus_query_request(r#"{ "mode": "range", "query": "up" }"#)
        .expect_err("range query should require start/end/step");

    assert_eq!(error.code, "prometheus-query-spec-invalid");
}
