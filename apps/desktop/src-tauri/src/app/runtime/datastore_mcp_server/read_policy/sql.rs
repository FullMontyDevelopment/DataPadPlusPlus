use super::*;

pub(super) fn validate(query: &str) -> Result<(), McpError> {
    let lower = strip_leading_comments(query).to_ascii_lowercase();
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

fn strip_leading_comments(query: &str) -> String {
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
