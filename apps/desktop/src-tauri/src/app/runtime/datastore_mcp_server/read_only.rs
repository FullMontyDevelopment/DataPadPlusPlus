use super::*;

pub(super) fn operation_is_mcp_safe(operation: &DatastoreOperationManifest) -> bool {
    matches!(operation.risk.as_str(), "read" | "diagnostic")
        && !operation.requires_confirmation
        && operation.execution_support == "live"
        && !operation.preview_only.unwrap_or(false)
        && !operation.id.ends_with("diagnostics.metrics")
}

pub(super) fn validate_read_only_query(
    query: &str,
    language: Option<&str>,
) -> Result<(), McpError> {
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return Err(McpError::invalid_params(
            "MCP query text is required.",
            None,
        ));
    }
    if has_multiple_statements(trimmed) {
        return Err(McpError::invalid_params(
            "MCP v1 rejects multi-statement queries.",
            None,
        ));
    }
    let language = language.unwrap_or_default().to_ascii_lowercase();
    if language.contains("mongo") {
        return validate_mongo_read_only(trimmed);
    }
    if language.contains("redis") || language.contains("valkey") {
        return validate_redis_read_only(trimmed);
    }
    if trimmed.starts_with('{') || trimmed.starts_with('[') {
        return validate_json_query_read_only(trimmed);
    }
    validate_sql_read_only(trimmed)
}

pub(super) fn has_multiple_statements(query: &str) -> bool {
    let mut in_single = false;
    let mut in_double = false;
    let mut escaped = false;
    let mut semicolon_count = 0;
    for character in query.chars() {
        if escaped {
            escaped = false;
            continue;
        }
        if character == '\\' {
            escaped = true;
            continue;
        }
        match character {
            '\'' if !in_double => in_single = !in_single,
            '"' if !in_single => in_double = !in_double,
            ';' if !in_single && !in_double => semicolon_count += 1,
            _ => {}
        }
    }
    if semicolon_count == 0 {
        return false;
    }
    let without_trailing = query
        .trim_end_matches(|character: char| character == ';' || character.is_ascii_whitespace());
    semicolon_count > 1 || without_trailing.contains(';')
}

pub(super) fn validate_sql_read_only(query: &str) -> Result<(), McpError> {
    let lower = strip_leading_sql_comments(query).to_ascii_lowercase();
    let lower = lower.trim_start();
    let allowed_start = [
        "select", "with", "show", "describe", "desc", "explain", "pragma",
    ]
    .iter()
    .any(|prefix| lower.starts_with(prefix));
    if !allowed_start {
        return Err(McpError::invalid_params(
            "MCP v1 only allows read-looking queries.",
            None,
        ));
    }
    let normalized = lower
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || character == '_' {
                character
            } else {
                ' '
            }
        })
        .collect::<String>();
    let blocked = [
        "insert", "update", "delete", "drop", "alter", "create", "truncate", "merge", "grant",
        "revoke", "copy", "vacuum", "analyze", "reindex", "call", "execute", "exec", "load",
        "attach", "detach", "replace", "upsert",
    ];
    if let Some(keyword) = blocked
        .iter()
        .find(|keyword| normalized.split_whitespace().any(|word| word == **keyword))
    {
        return Err(McpError::invalid_params(
            format!("MCP v1 rejects read queries containing `{keyword}`."),
            None,
        ));
    }
    Ok(())
}

pub(super) fn strip_leading_sql_comments(query: &str) -> String {
    let mut remaining = query.trim_start();
    loop {
        if let Some(rest) = remaining.strip_prefix("--") {
            if let Some((_, after)) = rest.split_once('\n') {
                remaining = after.trim_start();
                continue;
            }
            return String::new();
        }
        if let Some(rest) = remaining.strip_prefix("/*") {
            if let Some((_, after)) = rest.split_once("*/") {
                remaining = after.trim_start();
                continue;
            }
            return String::new();
        }
        return remaining.to_string();
    }
}

pub(super) fn validate_mongo_read_only(query: &str) -> Result<(), McpError> {
    let lower = query.to_ascii_lowercase();
    let blocked = [
        "insert",
        "update",
        "delete",
        "remove",
        "drop",
        "renamecollection",
        "bulk_write",
        "bulkwrite",
        "$out",
        "$merge",
        "mapreduce",
        "createindex",
        "dropindex",
        "aggregate([",
    ];
    if let Some(keyword) = blocked.iter().find(|keyword| lower.contains(**keyword)) {
        return Err(McpError::invalid_params(
            format!("MCP v1 rejects MongoDB queries containing `{keyword}`."),
            None,
        ));
    }
    Ok(())
}

pub(super) fn validate_redis_read_only(query: &str) -> Result<(), McpError> {
    let command = query
        .split_whitespace()
        .next()
        .unwrap_or_default()
        .to_ascii_uppercase();
    let allowed = [
        "GET",
        "MGET",
        "HGET",
        "HGETALL",
        "HMGET",
        "LRANGE",
        "SMEMBERS",
        "ZRANGE",
        "ZREVRANGE",
        "SCAN",
        "SSCAN",
        "HSCAN",
        "ZSCAN",
        "KEYS",
        "TYPE",
        "TTL",
        "PTTL",
        "STRLEN",
        "LLEN",
        "SCARD",
        "ZCARD",
        "XLEN",
        "XRANGE",
        "XREVRANGE",
        "INFO",
        "DBSIZE",
        "EXISTS",
        "MEMORY",
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

pub(super) fn validate_json_query_read_only(query: &str) -> Result<(), McpError> {
    let lower = query.to_ascii_lowercase();
    let blocked = [
        "$out",
        "$merge",
        "delete",
        "deletebyquery",
        "update",
        "updatebyquery",
        "insert",
        "put",
        "batchwrite",
        "transactwrite",
        "_bulk",
        "_delete_by_query",
        "_update_by_query",
    ];
    if let Some(keyword) = blocked.iter().find(|keyword| lower.contains(**keyword)) {
        return Err(McpError::invalid_params(
            format!("MCP v1 rejects query DSL containing `{keyword}`."),
            None,
        ));
    }
    Ok(())
}

pub(super) fn language_for(connection: &ConnectionProfile) -> String {
    match connection.engine.as_str() {
        "mongodb" => "mongodb",
        "redis" | "valkey" => "redis",
        "elasticsearch" | "opensearch" => "query-dsl",
        "dynamodb" => "json",
        "cassandra" => "cql",
        "snowflake" => "snowflake-sql",
        "bigquery" => "google-sql",
        "clickhouse" => "clickhouse-sql",
        "duckdb" => "duckdb-sql",
        _ if matches!(
            connection.family.as_str(),
            "sql" | "warehouse" | "embedded-olap"
        ) =>
        {
            "sql"
        }
        _ => "text",
    }
    .into()
}
