use serde_json::json;

use super::{mysql_buffer_pool_hit_rate, push_mysql_metric};

#[test]
fn computes_mysql_buffer_pool_hit_rate_from_status_counters() {
    let mut statuses = std::collections::BTreeMap::new();
    statuses.insert("Innodb_buffer_pool_read_requests".into(), 99.0);
    statuses.insert("Innodb_buffer_pool_reads".into(), 1.0);

    assert_eq!(mysql_buffer_pool_hit_rate(&statuses), Some(99.0));
}

#[test]
fn skips_missing_mysql_metrics() {
    let mut metrics = Vec::new();

    push_mysql_metric(&mut metrics, "mysql.present", Some(7.0), "rows", json!({}));
    push_mysql_metric(&mut metrics, "mysql.missing", None, "rows", json!({}));

    assert_eq!(metrics.len(), 1);
    assert_eq!(metrics[0]["name"], "mysql.present");
}
