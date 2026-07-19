use super::*;

pub(super) fn validate(query: &str) -> Result<(), McpError> {
    let command = query
        .split_whitespace()
        .next()
        .unwrap_or_default()
        .to_ascii_uppercase();
    let allowed = [
        "GET", "MGET", "HGET", "HGETALL", "HMGET", "LRANGE", "SMEMBERS", "ZRANGE",
        "ZREVRANGE", "SCAN", "SSCAN", "HSCAN", "ZSCAN", "KEYS", "TYPE", "TTL", "PTTL",
        "STRLEN", "LLEN", "SCARD", "ZCARD", "XLEN", "XRANGE", "XREVRANGE", "INFO",
        "DBSIZE", "EXISTS", "MEMORY",
    ];
    if allowed.contains(&command.as_str()) {
        Ok(())
    } else {
        Err(McpError::invalid_params(
            "MCP v1 only allows read-only Redis commands.",
            Some(json!({ "command": command })),
        ))
    }
}
