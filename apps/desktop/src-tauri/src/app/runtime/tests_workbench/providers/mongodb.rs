use super::{DatastoreTestExecutionProvider, QueryExecutionProvider};
use crate::domain::models::{ConnectionProfile, ScopedQueryTarget};
use serde_json::json;

static PROVIDER: QueryExecutionProvider = QueryExecutionProvider::new(
    "mongodb-test-execution",
    "mongodb",
    &["database", "collection", "gridfs-collection", "view"],
    starter_query,
    false,
);

pub(super) fn provider() -> &'static dyn DatastoreTestExecutionProvider {
    &PROVIDER
}

fn starter_query(connection: &ConnectionProfile, target: &ScopedQueryTarget) -> String {
    if target.kind.eq_ignore_ascii_case("database") {
        return json!({
            "database": target.label,
            "operation": "runCommand",
            "command": { "ping": 1 }
        })
        .to_string();
    }

    let database = target
        .path
        .iter()
        .find(|part| {
            part.as_str() != target.label
                && !matches!(part.to_ascii_lowercase().as_str(), "collections" | "views")
        })
        .cloned()
        .or_else(|| connection.database.clone())
        .unwrap_or_else(|| connection.name.clone());
    json!({
        "database": database,
        "collection": target.label,
        "filter": {},
        "limit": 1
    })
    .to_string()
}
