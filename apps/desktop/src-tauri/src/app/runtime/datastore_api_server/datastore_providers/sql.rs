use super::super::*;

pub(super) fn read_query(_engine: &str, resource: &ResourceRouteTarget, limit: u32, identity: Option<&Value>) -> Result<String, ApiRouteError> {
    let where_clause = sql_identity_where(identity)?;
    Ok(format!("select * from {}{} limit {}", sql_identifier(&resource.name), where_clause, limit))
}

pub(super) fn edit_kind(kind: &str, method: &str) -> Option<&'static str> {
    match (kind, method) {
        ("table", "POST") => Some("insert-row"),
        ("table", "PATCH") => Some("update-row"),
        ("table", "DELETE") => Some("delete-row"),
        _ => None,
    }
}
