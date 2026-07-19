use super::super::*;

pub(super) fn read_query(engine: &str, resource: &ResourceRouteTarget, limit: u32, identity: Option<&Value>) -> Result<String, ApiRouteError> {
    let mut query = json!({ "operation": "find", "collection": resource.name, "filter": mongo_identity_filter(identity), "limit": limit });
    if engine == "mongodb" {
        if let Some(database) = database_for_resource(resource) {
            query["database"] = json!(database);
        }
    }
    Ok(query.to_string())
}

pub(super) fn edit_kind(kind: &str, method: &str) -> Option<&'static str> {
    match (kind, method) {
        ("collection", "POST") => Some("insert-document"),
        ("collection", "PATCH") => Some("update-document"),
        ("collection", "DELETE") => Some("delete-document"),
        _ => None,
    }
}
