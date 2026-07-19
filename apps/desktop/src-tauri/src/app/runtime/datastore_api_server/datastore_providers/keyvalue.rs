use super::super::*;

pub(super) fn read_query(_engine: &str, resource: &ResourceRouteTarget, _limit: u32, identity: Option<&Value>) -> Result<String, ApiRouteError> {
    let key = identity.cloned().and_then(value_to_string).unwrap_or_else(|| resource.name.clone());
    Ok(format!("GET {}", quote_redis_key(&key)))
}

pub(super) fn edit_kind(kind: &str, method: &str) -> Option<&'static str> {
    match (kind, method) {
        ("key", "POST" | "PATCH") => Some("set-key-value"),
        ("key", "DELETE") => Some("delete-key"),
        _ => None,
    }
}
