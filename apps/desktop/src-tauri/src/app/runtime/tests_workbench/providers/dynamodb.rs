use super::{DatastoreTestExecutionProvider, QueryExecutionProvider};
use crate::domain::models::{ConnectionProfile, ScopedQueryTarget};
use serde_json::json;

static PROVIDER: QueryExecutionProvider = QueryExecutionProvider::new(
    "dynamodb-test-execution",
    "json",
    &["table"],
    starter_query,
    false,
);

pub(super) fn provider() -> &'static dyn DatastoreTestExecutionProvider {
    &PROVIDER
}

fn starter_query(_connection: &ConnectionProfile, target: &ScopedQueryTarget) -> String {
    json!({
        "operation": "Scan",
        "tableName": target.label,
        "limit": 1
    })
    .to_string()
}
