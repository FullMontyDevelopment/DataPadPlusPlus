use super::super::*;

pub(super) fn read_query(_engine: &str, resource: &ResourceRouteTarget, limit: u32, identity: Option<&Value>) -> Result<String, ApiRouteError> {
    if let Some(identity) = identity {
        return Ok(json!({ "operation": "GetItem", "tableName": resource.name, "key": dynamodb_key_from_identity(identity)?, "consistentRead": true, "returnConsumedCapacity": "TOTAL" }).to_string());
    }
    Ok(json!({ "operation": "Scan", "tableName": resource.name, "limit": limit, "returnConsumedCapacity": "TOTAL" }).to_string())
}

pub(super) fn edit_kind(kind: &str, method: &str) -> Option<&'static str> {
    match (kind, method) {
        ("item" | "table", "POST") => Some("put-item"),
        ("item" | "table", "PATCH") => Some("update-item"),
        ("item" | "table", "DELETE") => Some("delete-item"),
        _ => None,
    }
}
