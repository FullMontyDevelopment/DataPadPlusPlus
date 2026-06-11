use serde_json::json;

use super::active_target_count;

#[test]
fn active_target_count_reads_prometheus_target_shape() {
    let value = json!({
        "data": {
            "activeTargets": [
                { "health": "up" },
                { "health": "down" }
            ]
        }
    });

    assert_eq!(active_target_count(Some(&value)), 2);
    assert_eq!(active_target_count(None), 0);
}
