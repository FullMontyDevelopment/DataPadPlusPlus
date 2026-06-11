use serde_json::json;

use super::stats_count;

#[test]
fn opentsdb_stats_count_reads_array_shape() {
    let stats = json!([{ "metric": "a" }, { "metric": "b" }]);
    assert_eq!(stats_count(Some(&stats)), 2);
    assert_eq!(stats_count(None), 0);
}
