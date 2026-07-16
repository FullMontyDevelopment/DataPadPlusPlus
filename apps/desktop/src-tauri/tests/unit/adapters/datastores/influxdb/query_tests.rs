use serde_json::json;

use super::{influxdb_profile_payload, InfluxDbQueryRequest, NormalizedInfluxDbResult};

#[test]
fn influxdb_profile_uses_the_shared_profile_stage_contract() {
    let request = InfluxDbQueryRequest {
        database: "metrics".into(),
        path: "/query".into(),
        query: "select * from latency".into(),
        kind: "influxql",
    };
    let normalized = NormalizedInfluxDbResult {
        columns: vec!["time".into(), "value".into()],
        rows: vec![vec!["1".into(), "3".into()]],
        series: json!([]),
        statement_count: 1,
        total_rows: 2,
        truncated: true,
    };

    let profile = influxdb_profile_payload(&request, &normalized, 1, 18);

    assert_eq!(profile["stages"][0]["name"], "request");
    assert_eq!(profile["stages"][0]["durationMs"], 18);
    assert_eq!(profile["stages"][1]["name"], "result");
    assert_eq!(profile["stages"][1]["rows"], 1);
    assert_eq!(profile["stages"][2]["name"], "cardinality");
}
