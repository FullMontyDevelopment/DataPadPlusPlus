use super::{
    postgres_explain_payload, postgres_explain_text, postgres_profile_payload,
    postgres_profile_plan_payload,
};

#[test]
fn postgres_explain_text_prefers_plan_column() {
    let columns = vec!["QUERY PLAN".into(), "other".into()];
    let rows = vec![vec!["Seq Scan\nFilter: active".into(), "ignored".into()]];

    assert_eq!(
        postgres_explain_text(&columns, &rows),
        "Seq Scan\nFilter: active"
    );
}

#[test]
fn postgres_explain_text_falls_back_when_empty() {
    assert_eq!(
        postgres_explain_text(&[], &[]),
        "Explain plan returned no rows."
    );
}

#[test]
fn postgres_explain_payload_uses_plan_renderer_shape() {
    let payload = postgres_explain_payload(
        "EXPLAIN select * from accounts",
        &["QUERY PLAN".into()],
        &[vec!["Seq Scan on accounts\n  Filter: active".into()]],
    );

    assert_eq!(payload["renderer"], "plan");
    assert_eq!(payload["format"], "text");
    assert_eq!(payload["value"]["format"], "text");
    assert_eq!(payload["value"]["plan"][0], "Seq Scan on accounts");
    assert_eq!(payload["value"]["plan"][1], "  Filter: active");
    assert_eq!(
        payload["value"]["rows"][0][0],
        "Seq Scan on accounts\n  Filter: active"
    );
}

#[test]
fn postgres_profile_payload_flattens_json_plan_nodes() {
    let payload = postgres_profile_payload(&["QUERY PLAN".into()], &[vec![sample_profile_json()]]);

    assert_eq!(payload["renderer"], "profile");
    assert_eq!(payload["stages"][0]["name"], "Seq Scan on public.accounts");
    assert_eq!(payload["stages"][0]["durationMs"], 2.4);
    assert_eq!(payload["stages"][0]["rows"].as_f64(), Some(120.0));
    assert_eq!(payload["stages"][0]["details"]["planningMs"], 0.12);
    assert_eq!(payload["stages"][0]["details"]["executionMs"], 2.91);
    assert_eq!(payload["stages"][0]["details"]["nodeCount"], 2);
    assert_eq!(
        payload["stages"][0]["details"]["warnings"][0],
        "Plan includes a sequential scan."
    );
    assert_eq!(payload["stages"][1]["name"], "Index Scan on public.orders");
    assert_eq!(
        payload["stages"][1]["details"]["index"],
        "orders_account_id_idx"
    );
}

#[test]
fn postgres_profile_plan_payload_preserves_plan_table_and_raw_profile() {
    let payload = postgres_profile_plan_payload(
        "EXPLAIN (ANALYZE true, BUFFERS true, VERBOSE true, FORMAT JSON) select * from accounts",
        &["QUERY PLAN".into()],
        &[vec![sample_profile_json()]],
    );

    assert_eq!(payload["renderer"], "plan");
    assert_eq!(payload["format"], "json");
    assert_eq!(
        payload["value"]["plan"][0],
        "Seq Scan on public.accounts  actual rows=120  plan rows=10  loops=1  time=2.400 ms"
    );
    assert_eq!(payload["value"]["columns"][0], "Depth");
    assert_eq!(
        payload["value"]["rows"][0][1],
        "Seq Scan on public.accounts"
    );
    assert_eq!(payload["value"]["rows"][0][3], "120");
    assert_eq!(
        payload["value"]["rows"][1][1],
        "Index Scan on public.orders"
    );
    assert_eq!(payload["value"]["profile"][0]["Execution Time"], 2.91);
}

fn sample_profile_json() -> String {
    r#"
    [{
      "Plan": {
        "Node Type": "Seq Scan",
        "Schema": "public",
        "Relation Name": "accounts",
        "Alias": "accounts",
        "Startup Cost": 0.0,
        "Total Cost": 12.8,
        "Plan Rows": 10,
        "Plan Width": 48,
        "Actual Startup Time": 0.02,
        "Actual Total Time": 2.4,
        "Actual Rows": 120,
        "Actual Loops": 1,
        "Shared Hit Blocks": 6,
        "Temp Read Blocks": 1,
        "Plans": [{
          "Node Type": "Index Scan",
          "Schema": "public",
          "Relation Name": "orders",
          "Index Name": "orders_account_id_idx",
          "Plan Rows": 100,
          "Actual Total Time": 0.4,
          "Actual Rows": 12,
          "Actual Loops": 1,
          "Shared Hit Blocks": 4
        }]
      },
      "Planning Time": 0.12,
      "Execution Time": 2.91
    }]
    "#
    .to_string()
}
