use super::*;

pub(super) fn validate(query: &str) -> Result<(), McpError> {
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
