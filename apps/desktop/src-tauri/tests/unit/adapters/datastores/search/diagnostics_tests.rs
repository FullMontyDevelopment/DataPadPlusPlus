use serde_json::json;

use super::{index_count, search_diagnostic_plans};

#[test]
fn search_index_count_reads_cluster_stats_shape() {
    let stats = json!({ "indices": { "count": 12 } });
    assert_eq!(index_count(Some(&stats)), 12);
    assert_eq!(index_count(None), 0);
}

#[test]
fn search_diagnostic_plans_cover_slow_log_and_allocation_requests() {
    let plans = search_diagnostic_plans("elasticsearch");
    assert_eq!(plans[0]["name"], "slow-log");
    assert!(plans[0]["requests"]
        .as_array()
        .unwrap()
        .iter()
        .any(|request| request == "GET /_settings?filter_path=**.search.slowlog*"));
    assert_eq!(plans[1]["name"], "allocation");
    assert!(plans[1]["requests"]
        .as_array()
        .unwrap()
        .iter()
        .any(|request| request == "GET /_cluster/allocation/explain"));
}
