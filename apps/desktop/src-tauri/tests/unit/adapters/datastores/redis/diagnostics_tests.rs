use super::{info_keyspace_count, info_value_f64};

#[test]
fn parses_redis_info_metrics() {
    let info = "# Stats\r\ninstantaneous_ops_per_sec:42\r\nkeyspace_hits:90\r\n# Keyspace\r\ndb0:keys=7,expires=1,avg_ttl=10\r\ndb1:keys=3,expires=0,avg_ttl=0\r\n";

    assert_eq!(
        info_value_f64(info, "instantaneous_ops_per_sec"),
        Some(42.0)
    );
    assert_eq!(info_value_f64(info, "missing"), None);
    assert_eq!(info_keyspace_count(info), Some(10));
}
