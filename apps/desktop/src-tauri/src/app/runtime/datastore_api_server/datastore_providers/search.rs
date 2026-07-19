use super::super::*;

pub(super) fn read_query(_engine: &str, resource: &ResourceRouteTarget, limit: u32, identity: Option<&Value>) -> Result<String, ApiRouteError> {
    let query = identity.cloned().and_then(value_to_string)
        .map(|id| json!({ "ids": { "values": [id] } }))
        .unwrap_or_else(|| json!({ "match_all": {} }));
    Ok(json!({ "index": resource.name, "query": query, "size": limit }).to_string())
}

pub(super) fn edit_kind(kind: &str, method: &str) -> Option<&'static str> {
    match (kind, method) {
        ("index", "POST") => Some("index-document"),
        ("index", "PATCH") => Some("update-document"),
        ("index", "DELETE") => Some("delete-document"),
        _ => None,
    }
}
