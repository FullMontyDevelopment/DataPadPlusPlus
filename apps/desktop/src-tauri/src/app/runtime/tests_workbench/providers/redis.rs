use super::{DatastoreTestExecutionProvider, QueryExecutionProvider};
use crate::domain::models::{ConnectionProfile, ScopedQueryTarget};

static PROVIDER: QueryExecutionProvider = QueryExecutionProvider::new(
    "redis-test-execution",
    "redis",
    &["database", "prefix"],
    starter_query,
    false,
);

pub(super) fn provider() -> &'static dyn DatastoreTestExecutionProvider {
    &PROVIDER
}

pub(super) fn starter_query(_connection: &ConnectionProfile, target: &ScopedQueryTarget) -> String {
    if target.kind.eq_ignore_ascii_case("prefix") {
        format!("SCAN 0 MATCH {}* COUNT 25", target.label)
    } else {
        "PING".into()
    }
}
