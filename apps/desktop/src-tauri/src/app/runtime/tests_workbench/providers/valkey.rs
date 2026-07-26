use super::{DatastoreTestExecutionProvider, QueryExecutionProvider};

static PROVIDER: QueryExecutionProvider = QueryExecutionProvider::new(
    "valkey-test-execution",
    "redis",
    &["database", "prefix"],
    super::redis::starter_query,
    false,
);

pub(super) fn provider() -> &'static dyn DatastoreTestExecutionProvider {
    &PROVIDER
}
