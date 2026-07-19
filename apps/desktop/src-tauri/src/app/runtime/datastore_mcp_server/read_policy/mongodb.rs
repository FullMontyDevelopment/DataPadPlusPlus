use super::*;

pub(super) fn validate(query: &str) -> Result<(), McpError> {
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
