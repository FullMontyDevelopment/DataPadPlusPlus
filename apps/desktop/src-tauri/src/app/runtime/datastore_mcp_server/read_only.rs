use super::*;

#[path = "read_policy/mod.rs"]
mod read_policy;

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
    if read_policy::has_multiple_statements(trimmed) {
        return Err(McpError::invalid_params(
            "MCP v1 rejects multi-statement queries.",
            None,
        ));
    }
    read_policy::validate(trimmed, language)
}

pub(super) fn language_for(connection: &ConnectionProfile) -> String {
    read_policy::language_for_connection(connection)
}

#[cfg(test)]
pub(super) fn read_policy_registration_count(language: &str) -> usize {
    read_policy::matching_policy_count(language)
}
