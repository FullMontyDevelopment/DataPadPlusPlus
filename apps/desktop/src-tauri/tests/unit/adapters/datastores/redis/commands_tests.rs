use super::{is_redis_write_command, is_supported_redis_read_command};

#[test]
fn redis_command_support_is_validated_before_network_use() {
    assert!(is_supported_redis_read_command(&["PING"]));
    assert!(is_supported_redis_read_command(&["GET", "session:1"]));
    assert!(is_supported_redis_read_command(&["INFO"]));
    assert!(is_supported_redis_read_command(&["SLOWLOG", "GET", "10"]));
    assert!(is_supported_redis_read_command(&["ACL", "LIST"]));
    assert!(!is_supported_redis_read_command(&["GET"]));
    assert!(!is_supported_redis_read_command(&["EVAL", "return 1"]));
    assert!(is_redis_write_command(&["SET"]));
    assert!(is_redis_write_command(&["DEL"]));
    assert!(is_redis_write_command(&["FLUSHDB"]));
    assert!(is_redis_write_command(&["ACL", "SETUSER", "app"]));
    assert!(!is_redis_write_command(&["ACL", "LIST"]));
}
