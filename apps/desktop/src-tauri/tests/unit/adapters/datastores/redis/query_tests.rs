use super::{
    format_redis_list, format_redis_pairs, redis_command_lines, redis_scan_result,
    redis_value_to_resp, resp_bulk_string, validate_redis_console_command,
};
use redis::Value as RedisValue;

#[test]
fn redis_raw_formatters_show_returned_data() {
    assert_eq!(
        format_redis_list(&["session:1".into(), "session:2".into()]),
        "1) session:1\n2) session:2"
    );
    assert_eq!(
        format_redis_pairs(&["sku".into(), "luna-lamp".into()]),
        "1) sku\n2) luna-lamp"
    );
}

#[test]
fn redis_console_lines_support_pipeline_batches() {
    assert_eq!(
        redis_command_lines(
            r#"
            # inspect the selected keys
            TYPE session:1

            HGETALL session:1
            TTL session:1
            "#,
        ),
        vec!["TYPE session:1", "HGETALL session:1", "TTL session:1"]
    );
}

#[test]
fn redis_console_validation_blocks_writes_before_pipeline_execution() {
    assert!(validate_redis_console_command("TYPE session:1").is_ok());
    assert_eq!(
        validate_redis_console_command("SET session:1 active")
            .unwrap_err()
            .code,
        "redis-write-preview-only"
    );
}

#[test]
fn redis_resp_formatter_keeps_wire_style_available() {
    assert_eq!(resp_bulk_string("PONG"), "$4\r\nPONG");
    assert_eq!(
        redis_value_to_resp(&RedisValue::Array(vec![
            RedisValue::BulkString(b"sku".to_vec()),
            RedisValue::Int(42),
        ])),
        "*2\r\n$3\r\nsku\r\n:42"
    );
}

#[test]
fn redis_scan_result_caps_over_returned_keys_for_all_renderers() {
    let keys = (0..101)
        .map(|index| format!("session:{index}"))
        .collect::<Vec<_>>();

    let result = redis_scan_result(keys, 100);

    assert!(result.truncated);
    assert_eq!(result.visible_count, 100);
    assert_eq!(result.payloads[0]["rows"].as_array().unwrap().len(), 100);
    assert_eq!(
        result.payloads[1]["value"]["keys"]
            .as_array()
            .unwrap()
            .len(),
        100
    );
    assert!(!result.payloads[2]["text"]
        .as_str()
        .unwrap()
        .contains("session:100"));
    assert!(result.payloads[3]["text"]
        .as_str()
        .unwrap()
        .starts_with("*100"));
}
